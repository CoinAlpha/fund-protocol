const DataFeed = artifacts.require("./DataFeed.sol");
const NavCalculator = artifacts.require("./NavCalculator.sol");

// TO BE REPLACED
const InvestorActions = artifacts.require("./InvestorActions.sol");
const Fund = artifacts.require("./Fund.sol");

// NEW CONTRACTS
const NewInvestorActions = artifacts.require("./NewInvestorActions.sol");
const NewFund = artifacts.require("./NewFund.sol");
const FundStorage = artifacts.require("./FundStorage.sol");

const dataFeedInfo = require('./config/datafeed.js');

// helpers
const ethToWei = (eth) => eth * 1e18;

// DataFeed settings
const SECONDS_BETWEEN_QUERIES = 300;

const USD_ETH_EXCHANGE_RATE = 450;
const USD_BTC_EXCHANGE_RATE = 10000;
const USD_LTC_EXCHANGE_RATE = 100;
const DATA_FEED_GAS_RESERVE = 1;

// Fund settings
const FUND_NAME = "CoinAlpha Falcon";
const FUND_SYMBOL = "FALC";
const FUND_DECIMALS = 4;
const MANAGER_USD_ETH_BASIS = 300;
const MIN_INITIAL_SUBSCRIPTION_ETH = 20;
const MIN_SUBSCRIPTION_ETH = 5;
const MIN_INITIAL_SUBSCRIPTION_USD = 10000;
const MIN_SUBSCRIPTION_USD = 5000;
const MIN_REDEMPTION_SHARES = 100000;
const ADMIN_FEE = 1;
const MGMT_FEE = 0;
const PERFORM_FEE = 20;

module.exports = function (deployer, network, accounts) {

  // Accounts
  const ADMINISTRATOR = accounts[0];
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];

  // 
  const useOraclize = true;
  const dataFeedReserve = ethToWei(DATA_FEED_GAS_RESERVE);

  if (network == "development") {

    console.log('******** Deploy environment: development *********');

    deployer.deploy(
      DataFeed,
      dataFeedInfo[network].navServiceUrl,    // _queryUrl
      SECONDS_BETWEEN_QUERIES,                // _secondsBetweenQueries
      USD_ETH_EXCHANGE_RATE * 100,            // _initialUsdEthRate
      USD_BTC_EXCHANGE_RATE * 100,            // _initialUsdBtcRate
      USD_LTC_EXCHANGE_RATE * 100,            // _initialUsdLtcRate
      EXCHANGE,                               // _exchange
      { from: ADMINISTRATOR, value: dataFeedReserve }
    )
      .then(() => deployer.deploy(
        NavCalculator,
        DataFeed.address,
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        InvestorActions,
        DataFeed.address,
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        FundStorage,
        FUND_NAME,                          // _name
        FUND_SYMBOL,                        // _symbol
        FUND_DECIMALS,                      // _decimals
        MIN_INITIAL_SUBSCRIPTION_USD * 100, // _minInitialSubscriptionUsd
        MIN_SUBSCRIPTION_USD * 100,         // _minSubscriptionUsd
        MIN_REDEMPTION_SHARES,              // _minRedemptionShares,
        ADMIN_FEE * 100,                    // _adminFeeBps
        MGMT_FEE * 100,                     // _mgmtFeeBps
        PERFORM_FEE * 100,                  // _performFeeBps
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        Fund,
        MANAGER,                        // _manager
        EXCHANGE,                       // _exchange
        NavCalculator.address,          // _navCalculator
        InvestorActions.address,        // _investorActions
        DataFeed.address,               // _dataFeed
        FUND_NAME,                      // _name
        FUND_SYMBOL,                    // _symbol
        FUND_DECIMALS,                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION_ETH), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION_ETH), // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,          // _minRedemptionShares,
        ADMIN_FEE * 100,                // _adminFeeBps
        MGMT_FEE * 100,                 // _mgmtFeeBps
        PERFORM_FEE * 100,              // _performFeeBps
        MANAGER_USD_ETH_BASIS * 100,    // _managerUsdEthBasis
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        NewInvestorActions,
        DataFeed.address,               // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        NewFund,
        MANAGER,                        // _manager
        EXCHANGE,                       // _exchange
        NavCalculator.address,          // _navCalculator
        NewInvestorActions.address,        // _investorActions
        DataFeed.address,               // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR }
      ))
      .then(() => FundStorage.deployed())
      .then(_fundStorage => _fundStorage.setFund(Fund.address))
      .then(() => console.log('  Contract addresses:'))
      .then(() => console.log(`  - DataFeed           | ${DataFeed.address}`))
      .then(() => console.log(`  - NAV                | ${NavCalculator.address}`))
      .then(() => console.log(`  - InvestorActions    | ${InvestorActions.address}`))
      .then(() => console.log(`  - FundStorage        | ${FundStorage.address}`))
      .then(() => console.log(`  - Fund               | ${Fund.address}`))
      .then(() => console.log(`  - NewInvestorActions | ${NewInvestorActions.address}`))
      .then(() => console.log(`  - NewFund            | ${NewFund.address}`));
  } else {

    // Network-specific variables
    const NAV_SERVICE_URL = dataFeedInfo[network].navServiceUrl;
    const DATA_FEED_ADDRESS = dataFeedInfo[network].dataFeedAddress;

    // assume that DataFeed has already been deployed and has an updated value() property
    deployer.deploy(
      NavCalculator,
      DATA_FEED_ADDRESS,
      { from: ADMINISTRATOR }
    )
      .then(() => deployer.deploy(
        InvestorActions,
        DATA_FEED_ADDRESS,
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        FundStorage,
        FUND_NAME,                      // _name
        FUND_SYMBOL,                    // _symbol
        FUND_DECIMALS,                  // _decimals
        MIN_INITIAL_SUBSCRIPTION_USD * 100, // _minInitialSubscriptionEth
        MIN_SUBSCRIPTION_USD * 100,     // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,          // _minRedemptionShares,
        ADMIN_FEE * 100,                // _adminFeeBps
        MGMT_FEE * 100,                 // _mgmtFeeBps
        PERFORM_FEE * 100,              // _performFeeBps
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        Fund,
        MANAGER,                        // _manager
        EXCHANGE,                       // _exchange
        NavCalculator.address,          // _navCalculator
        InvestorActions.address,        // _investorActions
        DATA_FEED_ADDRESS,              // _dataFeed
        FUND_NAME,                      // _name
        FUND_SYMBOL,                    // _symbol
        FUND_DECIMALS,                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION_ETH), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION_ETH), // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,          // _minRedemptionShares,
        ADMIN_FEE * 100,                // _adminFeeBps
        MGMT_FEE * 100,                 // _mgmtFeeBps
        PERFORM_FEE * 100,              // _performFeeBps
        MANAGER_USD_ETH_BASIS * 100,    // _managerUsdEthBasis
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        NewInvestorActions,
        DATA_FEED_ADDRESS,               // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR }
      ))
      .then(() => deployer.deploy(
        NewFund,
        MANAGER,                        // _manager
        EXCHANGE,                       // _exchange
        NavCalculator.address,          // _navCalculator
        InvestorActions.address,        // _investorActions
        DATA_FEED_ADDRESS,              // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR }
      ))
      .then(() => FundStorage.deployed())
      .then(_fundStorage => _fundStorage.setFund(Fund.address));
  }
};
