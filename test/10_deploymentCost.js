const path = require('path');
const Promise = require('bluebird');

const FundStorage = artifacts.require('./FundStorage.sol');
const Fund = artifacts.require('./Fund.sol');
const NewFund = artifacts.require('./NewFund.sol');
const DataFeed = artifacts.require('./DataFeed.sol');
const FundLogic = artifacts.require('./FundLogic.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

web3.eth.getTransactionReceiptMined = require('../utils/getTransactionReceiptMined.js');

// Contract instances
let instances;
let newFund;
let fund;
let fundStorage;
let dataFeed;
let fundLogic;
let investorActions;
let txReceipts;

contract('Deployment costs', (accounts) => {
  before('before: should prepare', () => {
    console.log(`  ****** START TEST [ ${scriptName} ] *******`);
    return Promise.all([
      Fund.deployed(),
      NewFund.deployed(),
      FundStorage.deployed(),
      DataFeed.deployed(),
      InvestorActions.deployed(),
      FundLogic.deployed(),
    ])
      .then((_instances) => {
        instances = _instances;
        [fund, newFund, fundStorage, dataFeed, investorActions, fundLogic] = _instances;
      })
      .catch(err => assert.throw(`failed to get instances: ${err.toString()}`))
      .then(() => Promise.all(instances.map(x => web3.eth.getTransactionPromise(x.address))))
      .then(_txReceipts => txReceipts = _txReceipts);
  });

  describe('Old contracts', () => {
    it('Gas for old contracts', () => {
      console.log(Object.keys(instances[0]));
      console.log(instances.map(instance => instance.address));
      console.log(instances.map(instance => instance.transactionHash));
      console.log(txReceipts);
    });
  });
});
