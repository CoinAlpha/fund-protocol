const path = require('path');
const Promise = require('bluebird');

const Fund = artifacts.require('./Fund.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');
const DataFeed = artifacts.require('./DataFeed.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

contract('Initialize Fund', (accounts) => {
  // helpers
  const getBalancePromise = address => web3.eth.getBalancePromise(address);
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToWei = eth => web3.toWei(eth, 'ether');

  const OWNER = accounts[0];
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const INITIAL_NAV = web3.toWei(1, 'ether');

  const GAS_AMT = 500000;
  const USD_ETH_EXCHANGE_RATE = 450;
  const USD_BTC_EXCHANGE_RATE = 10000;
  const USD_LTC_EXCHANGE_RATE = 100;
  const SECONDS_BETWEEN_QUERIES = 300;

  const MIN_INITIAL_SUBSCRIPTION = 20;
  const INVESTOR_ALLOCATION = 21;
  const MIN_SUBSCRIPTION = 5;
  const MIN_REDEMPTION_SHARES = 100000;
  const ADMIN_FEE = 1;
  const MGMT_FEE = 0;
  const PERFORM_FEE = 20;
  const MANAGER_USD_ETH_BASIS = 30000;
  
  let fund;
  let navCalculator;
  let investorActions;
  let INITIAL_BALANCE;

  before(() => DataFeed.new(
    '[NOT USED]',                           // _queryUrl
    SECONDS_BETWEEN_QUERIES,                // _secondsBetweenQueries
    USD_ETH_EXCHANGE_RATE * 100,            // _initialUsdEthRate
    USD_BTC_EXCHANGE_RATE * 100,            // _initialUsdBtcRate
    USD_LTC_EXCHANGE_RATE * 100,            // _initialUsdLtcRate
    EXCHANGE,                               // _exchange
    { from: OWNER, value: 0 }
  )
    .then((instance) => {
      console.log(`  ****** START TEST [ ${scriptName} ] *******`);
      dataFeed = instance;
      return Promise.all([
        NavCalculator.new(dataFeed.address, { from: OWNER }),
        InvestorActions.new(dataFeed.address, { from: OWNER }),
        getBalancePromise(EXCHANGE)
      ]);
    })
    .then((results) => {
      [navCalculator, investorActions, INITIAL_BALANCE] = results;
      return Fund.new(
        MANAGER,                            // _manager
        EXCHANGE,                           // _exchange
        navCalculator.address,              // _navCalculator
        investorActions.address,            // _investorActions
        dataFeed.address,                   // _dataFeed
        'TestFund',                         // _name
        'TEST',                             // _symbol
        4,                                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION),         // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,              // _minRedemptionShares,
        ADMIN_FEE * 100,                    // _adminFeeBps
        MGMT_FEE * 100,                     // _mgmtFeeBps
        PERFORM_FEE * 200,                  // _performFeeBps
        MANAGER_USD_ETH_BASIS,              // _managerUsdEthBasis
        { from: OWNER }
      );
    })
    .then((fundInstance) => {
      fund = fundInstance;
      return Promise.all([
        navCalculator.setFund(fund.address),
        investorActions.setFund(fund.address),
        dataFeed.updateWithExchange(100)
      ]);
    })
    .then(() => Promise.all([
      navCalculator.fundAddress.call({ from: MANAGER }),
      investorActions.fundAddress.call({ from: MANAGER })
    ]))
    .then(([navFund, investorActionsFund]) => {
      assert.equal(navFund, fund.address, 'Incorrect fund address in navCalculator');
      assert.equal(investorActionsFund, fund.address, 'Incorrect fund address in investorActionsFund');
    })
    .catch(err => console.log('**** BEFORE ERROR: ', err)));


  it('should instantiate with the right owner address', () => fund.getOwners()
    .then(_owners => assert.equal(_owners[0], OWNER, 'Owner addresses don\'t match')));

    it('should instantiate with the right manager address', () => fund.manager.call()
    .then(_manager => assert.equal(_manager, MANAGER, 'Manager addresses don\'t match')));

  it('should instantiate with the right exchange address', () => fund.exchange.call()
    .then(_exchange => assert.equal(_exchange, EXCHANGE, 'Exchange addresses don\'t match')));

  it('should instantiate with the right navCalculator address', () => fund.navCalculator.call()
    .then(_calculator => assert.equal(_calculator, navCalculator.address, 'Calculator addresses don\'t match')));

  it('should instantiate with the right investorActions address', () => fund.investorActions.call()
    .then(_investorActions => assert.equal(_investorActions, investorActions.address, 'InvestorActions addresses don\'t match')));

  it('should instantiate with the right dataFeed address', () => fund.dataFeed.call()
    .then(_dataFeed => assert.equal(_dataFeed, dataFeed.address, 'DataFeed addresses don\'t match')));

  it('should instantiate with the right initial NAV', () => fund.navPerShare.call()
    .then(_nav => assert.equal(_nav, 10000, 'Initial NAV doesn\'t equal 10000')));

  it('should instantiate with the right balance', () => Promise.all([
    dataFeed.value(),
    fund.getInvestor(MANAGER),
    fund.totalSupply()
  ]).then(([dataFeedValue, managerStruct, totalSupply]) => {
    assert.equal(parseInt(dataFeedValue, 10), parseInt(managerStruct[2], 10), 'Manager\'s account balance doesn\'t match investment');
    assert.equal(parseInt(totalSupply, 10), parseInt(managerStruct[2], 10), 'Total supply doesn\'t match manager\'s investment');
  }));
});
