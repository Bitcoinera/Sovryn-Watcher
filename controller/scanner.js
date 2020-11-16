/**
 * Contract position scanner
 * Reads all open positions from the Sovryn contract by quereing "active loans" in a loop. Stores open positions in a queue "positions" and
 * positions flagged for liquidation in "liquidations".
 */
import C from './contract';
import U from '../util/helper';
import conf from '../config/config';


class PositionScanner {
    /**
     * Empty positions and liquidations array is assigned from the main-controller.
     * This allows the liquidator controller to manipulate the liquidations list.
     */
    start(positions, liquidations) {
        this.positions=positions;
        this.liquidations=liquidations;
        this.processPositions();
    }

    /**
     * Start endless loop by loading all open positions from the contract until the end is reached, then start from scratch
     * It is necessary to re-read from position 0 on every run because the position of open positions can change on the contract.
     * Poosible optimization: parse the event logs after reaching current state instead of quering "getActiveLoans".
     */
    async processPositions() {
        console.log("Start processing active positions in "+conf.scannerInterval+" s interval");

        let from = 0;
        let to = conf.nrOfProcessingPositions;

        while (true) {
            //active positions need to be read in batches.
            const pos = await this.loadActivePositions(from, to);
            if (pos && pos.length>0) {
                this.addPosition(pos);
                //console.log(pos.length + " active positions found");
                from = to;
                to = from + conf.nrOfProcessingPositions;
                //wait a second to reduce the load from the node
                await U.wasteTime(1);
            }
            //empty array -> read all loans -> done
            else if(pos && pos.length==0) {
                console.log(Object.keys(this.positions).length+" active positions found");
                //waiting time between rounds like specified
                await U.wasteTime(conf.scannerInterval);
                //start from 0
                from = 0;
                to = conf.nrOfProcessingPositions;
                //delete the position list
                //note: this should be refactored, because the other controllers only have access to the incomplete position
                //list while the positions are being read from the contract. currently, it takes just a seconds, so
                //not yet crucial.
                for (let k in this.positions) if (this.positions.hasOwnProperty(k)) delete this.positions[k];
            }
            //error retrieving pos for this interval (node error). happens occasionally (1 out of 100 runs). reason unkown
            //Error: Returned error: VM execution error: transaction reverted
            else {
                console.error("Error retrieving pos");
                //skip it this run, pick it up the next
                from = to;
                to = from + conf.nrOfProcessingPositions;
                //wait a second to reduce the load from the node
                await U.wasteTime(1);
            }
        }
    }

    /**
     * Loading active positions from the contract
     * Returns an array or false
     */
    loadActivePositions(from, to) {
        //console.log("loading active positions from id " + from + " to " + to);
        return new Promise(resolve => {
            try {
                C.contractSovryn.methods.getActiveLoans(from, to, false).call((error, res) => {
                    if (error) {
                        console.error("Error receiving user loans from "+from+" to: "+to);
                        console.error(error);
                        return resolve(false);
                    }
                    resolve(res)
                });
            }
            catch (e) {
                console.error("Error on retrieving active loans from "+from+" to: "+to);
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

                if(l.maxLiquidatable>0) {
                    console.log("Margin call for  "+l.loanId+". Current margin: "+C.web3.utils.fromWei(l.currentMargin.toString(), "Ether"));
                    console.log("Liquidation will happen at: "+C.web3.utils.fromWei((l.maintenanceMargin*0.99).toString(), "Ether"));
                }
                //If liquidating at the very edge we often get errors if the price bounces back
                if(l.currentMargin<l.maintenanceMargin*0.99) this.liquidations[l.loanId] = l;
            }
        }
    }
}

export default new PositionScanner();