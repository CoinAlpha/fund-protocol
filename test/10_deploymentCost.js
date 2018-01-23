const path = require('path');
const Promise = require('bluebird');

const { constructors } = require('../migrations/artifacts');

const DataFeed = artifacts.require('./DataFeed.sol');
const NewNavCalculator = artifacts.require('./NewNavCalculator.sol');
const FundStorage = artifacts.require('./FundStorage.sol');
const FundLogic = artifacts.require('./FundLogic.sol');
const NewFund = artifacts.require('./NewFund.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

let managerBalanceStart;
let managerBalance;

// Contract Instances
let dataFeed;
let navCalculator;
let fundStorage;
let fundLogic;
let fund;

contract('Deployment costs', (accounts) => {
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];

  before('before: should get starting manager balance', () => web3.eth.getBalancePromise(MANAGER)
    .then(_bal => managerBalanceStart = web3.fromWei(_bal, 'ether')));

  beforeEach('before: should get manager balance', () => web3.eth.getBalancePromise(MANAGER)
    .then(_bal => managerBalance = web3.fromWei(_bal, 'ether'))
    .then(() => console.log(`\n      Manager balance before: ${managerBalance}`)));

  afterEach('after: should get manager balance', () => web3.eth.getBalancePromise(MANAGER)
    .then((_bal) => {
      const newBalance = web3.fromWei(_bal, 'ether');
      console.log(`      New balance:        ${newBalance}`);
      console.log(`      Difference:         ${managerBalance - newBalance}`);
      managerBalance = newBalance;
    }));

  after('after: get closing manager balance', () => web3.eth.getBalancePromise(MANAGER)
    .then((_bal) => {
      const newBalance = web3.fromWei(_bal, 'ether');
      console.log(`      Ending balance:     ${newBalance}`);
      console.log('\n      =========================================');
      console.log(`      TOTAL COST OF DEPLOYMENT: ${managerBalanceStart - newBalance}`);
    }));

  describe('Calculate cost', () => {
    it('DataFeed cost', () => constructors.DataFeed(MANAGER, EXCHANGE)
      .then(_instance => dataFeed = _instance));

    it('FundStorage cost', () => constructors.FundStorage(MANAGER, EXCHANGE)
      .then(_instance => fundStorage = _instance));

    it('FundLogic cost', () => constructors.FundLogic(MANAGER, dataFeed, fundStorage)
      .then(_instance => fundLogic = _instance));

    it('NavCalculator cost', () => constructors.FundLogic(MANAGER, dataFeed, fundStorage, fundLogic)
      .then(_instance => navCalculator = _instance));

    it('Fund cost', () => constructors.NewFund(MANAGER, dataFeed, fundStorage, fundLogic, navCalculator)
      .then(_instance => fund = _instance));

    it('fundStorage.setFund', () => fundStorage.setFund(fund.address));

    it('fundLogic.setFund', () => fundLogic.setFund(fund.address));

    it('navCalculator.setFund', () => navCalculator.setFund(fund.address));
  });
});
