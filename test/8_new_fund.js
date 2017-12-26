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

  const ethInvestors = investors.slice(5, 10);
  const usdInvestors = investors.slice(11, 16);

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

  describe('getFundDetails()', () => {

    let newFundDetails;
    let fundStorageDetails;

    it('can get fund details', () => newFund.getFundDetails()
      .then(_details => newFundDetails = _details)
      .catch(err => `Error calling newFund getFundDetails(): ${err.toString()}`)
      .then(() => Promise.all([
        fundStorage.name(),
        fundStorage.symbol(),
        fundStorage.minInitialSubscriptionUsd(),
        fundStorage.minSubscriptionUsd(),
        fundStorage.minRedemptionShares()
      ]))
      .then(_details => fundStorageDetails = _details)
      .then(() => newFundDetails.forEach((_detail, index) => {
        if (typeof _detail === 'string') {
          assert.strictEqual(_detail, fundStorageDetails[index], 'string details do not match');
        } else {
          assert.strictEqual(Number(_detail), Number(fundStorageDetails[index]), 'number details do not match');
        }
      }))
    );
  })  // describe

  describe('whiteListInvestor', () => {
    it('should have a whiteListInvestor function', () => assert.isDefined(newFund.whiteListInvestor, 'function undefined'));

    ethInvestors.forEach((_investor, index) => {
      it(`should whitelist an ETH investor [${index}] ${_investor}`, () =>
        newFund.whiteListInvestor(_investor, 1, { from: MANAGER })
          .catch(err => assert.throw(`Error whitelisting investor ${_investor}: ${err.toString()}`))
          .then(() => fundStorage.getInvestor(_investor))
          .then(_investor => assert.strictEqual(Number(_investor[0]), 1, 'incorrect investor type'))
          .catch(err => assert.throw(`Error getting investor: ${err.toString()}`))
      );
    });

    usdInvestors.forEach((_investor, index) => {
      it(`should whitelist a USD investor [${index}] ${_investor}`, () =>
        newFund.whiteListInvestor(_investor, 2, { from: MANAGER })
          .catch(err => assert.throw(`Error whitelisting investor ${_investor}: ${err.toString()}`))
          .then(() => fundStorage.getInvestor(_investor))
          .then(_investor => assert.strictEqual(Number(_investor[0]), 2, 'incorrect investor type'))
          .catch(err => assert.throw(`Error getting investor: ${err.toString()}`))
      );
    });

  }); // describe

  xdescribe('subscribeInvestors', () => {
    it('not allow ETH subscription below minimumInitialSubscriptionUsd', () => {

    });
    
    it('subscribe ETH investor', () => {
      
    });

    it('not allow USD subscription below minimumInitialSubscriptionUsd', () => {

    });

    it('subscribe USD investor', () => {

    });

    it('not allow repeat ETH subscription below minimumSubscriptionUsd', () => {

    });
    
    it('subscribe repeat ETH investor', () => {
      
    });

    it('not allow repeat USD subscription below minimumSubscriptionUsd', () => {

    });

    it('subscribe repeat USD investor', () => {

    });

  });

  xdescribe('changeModule', () => {
    it('NavCalculator', () => {

    });

    it('InvestorActions', () => {

    });

    it('DataFeed', () => {

    });

    it('FundStroage', () => {

    });
  });

}); // contract
