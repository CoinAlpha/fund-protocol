const path = require('path');
const Promise = require('bluebird');

const NewFund = artifacts.require('./NewFund.sol');
const FundStorage = artifacts.require('./FundStorage.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

contract('New Fund', (accounts) => {
  accounts.pop(); // Remove Oraclize account
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const FUND = accounts[2];
  const FUND2 = accounts[3];
  const NOTAUTHORIZED = accounts[4];
  const investors = accounts.slice(5);
  const INVESTOR1 = investors[0];
  const INVESTOR2 = investors[1];
  const INVESTOR3 = investors[2];
  const INVESTOR4 = investors[3];

  let newFund, fundStorage;

  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([NewFund.deployed(), FundStorage.deployed()])
      .then(_instances => [newFund, fundStorage] = _instances)
      .catch(err => assert.throw(`failed to get instances: ${err.toString()}`))
      .then(() => fundStorage.setFund(newFund.address, { from: MANAGER }))
      .catch(err => assert.throw(`failed - fundStorage.setFund(): ${err.toString()}`))
      .then(() => fundStorage.queryContainsInvestor(INVESTOR1))
      .then(contains => assert.strictEqual(Number(contains), 0, 'investor already whitelisted'))
      .catch(err => assert.throw(`failed queryContainsInvestor: ${err.toString()}`))
      .then(() => Promise.all([
        newFund.manager.call(),
        newFund.exchange.call(),
        newFund.navCalculator.call(),
        newFund.investorActions.call(),
        newFund.fundStorage.call()
      ]))
      .then(_addresses => _addresses.forEach(_address => assert.notEqual(_address, '0x0000000000000000000000000000000000000000', 'Contract address not set')))
      .catch(err => `  Error retrieving variables: ${err.toString()}`)
  });

  describe('should subscribe investors', () => {
    it('should have a whiteListInvestor function', () => assert.isDefined(newFund.whiteListInvestor, 'function undefined'));

    it('should whitelist an investor', () =>
      newFund.whiteListInvestor(INVESTOR1, 1, { from: MANAGER })
        .catch(err => assert.throw(`Error whitelisting investor ${INVESTOR1}: ${err.toString()}`))
        .then(() => fundStorage.getInvestor(INVESTOR1))
        .then(_investor => console.log(_investor))
        .catch(err => assert.throw(`Error getting investor: ${err.toString()}`))
    );

  }); // describe

}); // contract
