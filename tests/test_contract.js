/**
 * Contract tester
 * These approvals should be executed for every liquidator wallet once
*/
const assert = require('assert');
import conf from '../config/config_testnet';
import C from './contract';

C.init(conf);
const amount = txCtrl.web3.utils.toWei("1000000000", 'ether');
//todo: define wallet, gas and gasprice
const from = "";

describe('Contract', async () => {
    describe('#basic function', async () => {
        
        it('should approve the Sovryn contract to spend RBTC for the main account', async () => {
            (tokenCtr, from, receiver, amount)
            const approved = await C.approveToken(C.contractTokenRBTC, from, conf.sovrynProtocolAdr, amount);
            assert(approved.length == 66);
        });    

        it('should approve the Sovryn contract to spend SUSD for the main account', async () => {
            const approved = await C.approveToken(C.contractTokenSUSD, from, conf.sovrynProtocolAdr, amount);
            assert(approved.length == 66);
        }); 

        it('should approve the rBTC IToken contract to spend sUSD for the main account', async () => {
            const approved = await C.approveToken(C.contractTokenSUSD, from, conf.loanTokenRBTC, amount);
            assert(approved.length == 66);
        }); 

        it('should approve the rBTC IToken contract to spend rBTC for the main account', async () => {
            const approved = await C.approveToken(C.contractTokenRBTC, from, conf.loanTokenRBTC, amount);
            assert(approved.length == 66);
        }); 

        it('should approve the sUSD IToken contract to spend rBTC for the main account', async () => {
            const approved = await C.approveToken(C.contractTokenRBTC, from, conf.loanTokenSUSD, amount);
            assert(approved.length == 66);
        }); 

        it('should approve the sUSD IToken contract to spend sUSD for the main account', async () => {
            const approved = await C.approveToken(C.contractTokenSUSD, from, conf.loanTokenSUSD, amount);
            assert(approved.length == 66);
        }); 

        it('should check wheter the Itoken contract is allowed to spend sUSD for the main account', async() => {
            //todo check wheter above tx have desired result
            assert(true);
        })
    });
});




/*
**************************************************************************
********************helpers***********************************************
**************************************************************************
*/



async function checkAllowance(contract, adr, token) {
    return new Promise(async (resolve) => {
        try {
            C.contractSovryn.methods.getLoan(loanId).call((error, result) => {
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