// DEPLOY PARAMETERS
const {
  SECONDS_BETWEEN_QUERIES,
  USD_ETH_EXCHANGE_RATE,
  USD_BTC_EXCHANGE_RATE,
  USD_LTC_EXCHANGE_RATE,
  DATA_FEED_GAS_RESERVE,
  FUND_NAME,
  FUND_SYMBOL,
  FUND_DECIMALS,
  MANAGER_USD_ETH_BASIS,

  // TODO: DELETE
  MIN_INITIAL_SUBSCRIPTION_ETH,
  MIN_SUBSCRIPTION_ETH,

  MIN_INITIAL_SUBSCRIPTION_USD,
  MIN_SUBSCRIPTION_USD,
  MIN_REDEMPTION_SHARES,
  ADMIN_FEE,
  MGMT_FEE,
  PERFORM_FEE,
} = require('../config');

const allArtifacts = {
  OwnableModified: artifacts.require('./OwnableModified.sol'),
  NavCalculator: artifacts.require('./NavCalculator.sol'),
  InvestorActions: artifacts.require('./InvestorActions.sol'),
  Fund: artifacts.require('./Fund.sol'),
  DataFeed: artifacts.require('./DataFeed.sol'),
  FundStorage: artifacts.require('./FundStorage.sol'),
  FundLogic: artifacts.require('./FundLogic.sol'),
  NewNavCalculator: artifacts.require('./NewNavCalculator.sol'),
  NewFund: artifacts.require('./NewFund.sol'),
};

const ethToWei = eth => web3.toWei(eth, 'ether');

const constructors = {
  OwnableModified: owner => allArtifacts.OwnableModified.new({ from: owner }),
  DataFeed: (owner, exchange) => allArtifacts.DataFeed.new(
    '[NOT USED]',                             // _queryUrl
    SECONDS_BETWEEN_QUERIES,                  // _secondsBetweenQueries
    USD_ETH_EXCHANGE_RATE * 100,              // _initialUsdEthRate
    USD_BTC_EXCHANGE_RATE * 100,              // _initialUsdBtcRate
    USD_LTC_EXCHANGE_RATE * 100,              // _initialUsdLtcRate
    exchange,                                 // _exchange
    { from: owner, value: 0 },
  ),

  // ====================== TODO: DELETE  
  NavCalculator: (owner, dataFeed) => allArtifacts.NavCalculator.new(dataFeed, { from: owner }),
  InvestorActions: (owner, dataFeed) => allArtifacts.InvestorActions.new(dataFeed, { from: owner }),
  Fund: (owner, exchange, navCalculator, investorActions, dataFeed, fundStorage) =>
    allArtifacts.Fund.new(
      owner,                                  // _manager
      exchange,                               // _exchange
      navCalculator.address,                  // _navCalculator
      investorActions.address,                // _investorActions
      dataFeed.address,                       // _dataFeed
      'TestFund',                             // _name
      'TEST',                                 // _symbol
      4,                                      // _decimals
      ethToWei(MIN_INITIAL_SUBSCRIPTION_ETH), // _minInitialSubscriptionEth
      ethToWei(MIN_SUBSCRIPTION_ETH),         // _minSubscriptionEth
      MIN_REDEMPTION_SHARES * 100,            // _minRedemptionShares,
      ADMIN_FEE * 100,                        // _adminFeeBps
      MGMT_FEE * 100,                         // _mgmtFeeBps
      PERFORM_FEE * 100,                      // _performFeeBps
      MANAGER_USD_ETH_BASIS * 100,            // _managerUsdEthBasis
      { from: owner },
    ),
  // ======================

  FundStorage: (owner, exchange) => allArtifacts.FundStorage.new(
    owner,                                    // _manager
    exchange,                                 // _exchange
    'TestFund',                               // _name
    'TEST',                                   // _symbol
    FUND_DECIMALS,                            // _decimals
    MIN_INITIAL_SUBSCRIPTION_USD * 100,       // _minInitialSubscriptionUsd
    MIN_SUBSCRIPTION_USD * 100,               // _minSubscriptionUsd
    MIN_REDEMPTION_SHARES * 100,              // _minRedemptionShares,
    ADMIN_FEE * 100,                          // _adminFeeBps
    MGMT_FEE * 100,                           // _mgmtFeeBps
    PERFORM_FEE * 100,                        // _performFeeBps
    { from: owner },
  ),
  FundLogic: (owner, dataFeed, fundStorage) => allArtifacts.FundLogic.new(
    dataFeed.address,
    fundStorage.address,
    { from: owner },
  ),
  NewNavCalculator: (owner, dataFeed, fundStorage, fundLogic) => allArtifacts.NewNavCalculator.new(
    dataFeed.address,
    fundStorage.address,
    fundLogic.address,
    { from: owner },
  ),
  NewFund: (owner, dataFeed, fundStorage, fundLogic, navCalculator) =>
    allArtifacts.NewFund.new(
      dataFeed.address,                     // _dataFeed
      fundStorage.address,                  // _fundStorage
      fundLogic.address,                    // _fundLogic
      navCalculator.address,                // _navCalculator
      { from: owner },
    ),
};

module.exports = {
  allArtifacts,
  constructors,
};
