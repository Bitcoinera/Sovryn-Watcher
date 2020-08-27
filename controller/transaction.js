/**
 * Transaction controller
 * Reads all open positions from the blockchain by quereing "active loans" in a loop. Stores open positions in a queue "positions" and
 * positions flagged for liquidation in "liquidations".
 * Monitors every position on the loantoken contract and checks if it is still open and if it needs to be liquidated or not.
 * 
 */

import Web3 from 'web3';
import abiComplete from '../config/abiComplete';
import abiTestToken from '../config/abiTestToken';
import owner from '../secrets/account';
import U from '../util/helper';
const TelegramBot = require('node-telegram-bot-api');

class TransactionController {
    /**
     * Creates a Bzx contract intance to query current open positions
     */
    constructor() {
        this.web3 = new Web3(conf.nodeProvider);
        this.web3.eth.accounts.privateKeyToAccount(owner.pKey);
        this.contractBzx = new this.web3.eth.Contract(abiComplete, conf.bzxProtocolAdr);
        this.contractTokenSUSD = new this.web3.eth.Contract(abiTestToken, conf.testTokenSUSD);
        this.contractTokenRBTC = new this.web3.eth.Contract(abiTestToken, conf.testTokenRBTC);
        this.telegramBotWatcher = new TelegramBot(conf.errorBotWatcherTelegramToken, {polling: false});
        this.positions = {};
        this.liquidations = {};
    }


    /**
     * Start processing active positions and liquidation
     */
    async start() {
        const b = await this.web3.eth.getBlockNumber();
        console.log("Connected to rsk " + conf.network + "-network. Current block " + b);
        this.processPositions();
        this.checkPositions();
    }

    /**
     * Start endless loop by loading all open positions from the contract until the end is reached, then start from scratch
     * It is necessary to re-read from position 0 on every run because the position of open positions can change on the contract.
     * Poosible optimization: parse the event logs after reaching current state instead of quering of "getActiveLoans".
     * 
     * The performance of this overhead need to be tested and optimized if needed
     * Known issues: new open positions can have a different LoanId after some blocks got mined
     */
    async processPositions() {
        console.log("Start processing active loans");

        let from = 0;
        let to = conf.nrOfProcessingPositions;

        while (true) {
            const pos = await this.loadActivePositions(from, to);
            if(pos) {
                this.addPosition(pos);
                console.log(pos.length+" active positions found");
            }

            if (pos.length > 0) {
                from = to;
                to = from + conf.nrOfProcessingPositions;
                await U.wasteTime(1);
            }
            //reached current state
            else {
                await U.wasteTime(conf.waitBetweenRounds);
                from = 0;
                to = conf.nrOfProcessingPositions;
                this.positions={};
            }
        }
    }

    /**
     * Loading active positions from the contract
     * check order (0-10 = first 10 or last 10??)
     */
    loadActivePositions(from, to) {
        //console.log("loading active positions from id " + from + " to " + to);
        
        let p = this;
        return new Promise(resolve => {
            try {
                p.contractBzx.methods.getActiveLoans(from, to, false).call((error, res) => {
                    if (error) {
                        console.error("error receiving user loans");
                        console.error(error);
                        return resolve();
                    }
                    resolve(res)
                });
            }
            catch(e){
                console.error("error on retrieving active loans");
                console.error(e);
                resolve(false);
            }
        });
    }

    /**
     * Adding new positions to the positions queue, 
     * positions ready for liquidation to the liquidations queue
     */
    addPosition(loans) {
        for (let l of loans) {
            if (!l.loanId) continue;

            if (!this.positions[l.loanId]) {
                this.positions[l.loanId] = l;

                if (this.getLiquidationStatus(this.positions[l.loanId])) this.liquidations[l.loanId] = l;
            }
            else console.log("found duplicate loan-id " + l.loanId);
        }
    }

    /**
     * Wrapper for liquidations
     * If liquidation successful removes position from liquidation list
     * If it fails, check if the liquidation criteria are still met. 
     * If no, delete it from the liquidation list. If yes, send an error notification to a telegram groupfor manual processing. 
     * Todo: If the tx was not confirmed after some time (10 minutes), resend the transaction with a higher (double) gas fee.
     */
    async checkPositions() {
        while(true) {
            console.log("started liquidation round at " + new Date(Date.now()));
            console.log(Object.keys(this.liquidations).length+" positions need to be liquidated");
            
            for (let p in this.liquidations) {
                const pos = this.liquidations[p];
                const liquidated = await this.liquidate(p, owner.adr, pos.principal);
                if(liquidated) delete this.liquidations[p];
                else {
                    console.error("error liquidating loan "+p);
                    console.error(pos);
                    const updatedLoan = await this.getPositionStatus(p)
                    if (this.getLiquidationStatus(updatedLoan)) {
                        console.log("loan "+p+ " should still be liquidated. Please check manually");
                        this.telegramBotWatcher.sendMessage(conf.sovrynInternalTelegramId, conf.network+"net-liquidation of loan "+p+" failed.");
                    }
                    delete this.liquidations[p];
                }
                
            }
            console.log("completed liquidation round at " + new Date(Date.now()));
            await U.wasteTime(conf.waitBetweenRounds);
        }
    }

    /*
    * Tries to liquidate a position
    */
    liquidate(loanId, receiver, amount) {
        let p = this;
        return new Promise(async (resolve) => {
            console.log("trying to liquidate loan " + loanId);
            
            p.contractBzx.methods.liquidate(loanId, receiver, amount)
            .send({ from: owner.adr, gas: 2500000 })
            .then(async (tx) => {
                console.log("loan " + loanId + " liquidated!");
                console.log(tx);
                resolve(true);
            })
            .catch((err) => {
                console.error("Error on liquidating loan " + loanId);
                console.error(err);
                resolve(false);
            });
        });
    }

    /**
     * Returns loan status true if it needs to be liquidated, false otherwise
     * Liquidation status means current margin <= maintenance margin
     */
    getLiquidationStatus(loan) {
        if (loan.currentMargin && loan.maintenanceMargin) {
            const curr = this.web3.utils.fromWei(loan.currentMargin, 'ether'); //returns margin in %
            const mM = this.web3.utils.fromWei(loan.maintenanceMargin, 'ether'); //returns margin in %

            //console.log("current margin: " + curr);
            //console.log("maintenance margin: " + mM);
            if (curr <= mM) {
                console.log("loan " + loan.loanId + " needs to be liquidated. Current margin (" + curr + ") <= maintenanceMargin (" + mM + ").");
                return true;
            }
        }
        return false;
    }

    /**
     * Loads complete position info from the Sovryn contract
     */
    async getPositionStatus(loanId) {
        let p = this;
        return new Promise(resolve => {
            try {
                p.contractBzx.methods.getLoan(loanId).call((error, result) => {
                    if (error) {
                        console.error("error loading loan "+loanId);
                        console.error(error);
                        return resolve(false);
                    }
                    resolve(result);
                });
            }
            catch (e) {
                console.error("error on retrieving loan status for loan-id "+loanId);
                console.error(e);
                resolve(false)
            }
        });
    }

    /**
    * Tokenholder approves the loan token contract to spend tokens on his behalf
    * This is needed in order to be able to liquidate a position and should be executed once in the beginning
    */
    approveToken(tokenCtr, receiver, amount) {
        return new Promise(resolve => {
            tokenCtr.methods.approve(receiver, amount)
                .send({ from: owner.adr })
                .then((tx) => {
                    console.log("Approved Transaction: ");
                    //console.log(tx);
                    if (tx.transactionHash) resolve(tx.transactionHash);
                    else resolve();
                });
        });
    }

    /**
     * helper function
     */
    getTokenInstance(adr) {
        if (adr == conf.testTokenSUSD) return this.contractTokenSUSD;
        else if (adr == conf.testTokenRBTC) return this.contractTokenRBTC;
    }
}

export default TransactionController;