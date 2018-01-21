const DataFeed = artifacts.require('./DataFeed.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');

// TO BE REPLACED
const InvestorActions = artifacts.require('./InvestorActions.sol');
const Fund = artifacts.require('./Fund.sol');

// NEW CONTRACTS
const FundLogic = artifacts.require('./FundLogic.sol');
const NewFund = artifacts.require('./NewFund.sol');
const FundStorage = artifacts.require('./FundStorage.sol');
const NewNavCalculator = artifacts.require('./NewNavCalculator.sol');

const dataFeedInfo = require('../config/datafeed.js');

// helpers
const ethToWei = eth => eth * 1e18;

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
  MIN_INITIAL_SUBSCRIPTION_ETH,
  MIN_SUBSCRIPTION_ETH,
  MIN_INITIAL_SUBSCRIPTION_USD,
  MIN_SUBSCRIPTION_USD,
  MIN_REDEMPTION_SHARES,
  ADMIN_FEE,
  MGMT_FEE,
  PERFORM_FEE,
} = require('../config');

module.exports = (deployer, network, accounts) => {
  // Accounts
  const ADMINISTRATOR = accounts[0];
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];

  const useOraclize = true;
  const dataFeedReserve = ethToWei(DATA_FEED_GAS_RESERVE);

  if (network === 'development') {
    console.log('******** Deploy environment: development *********');

    deployer.deploy(
      DataFeed,
      dataFeedInfo[network].navServiceUrl,    // _queryUrl
      SECONDS_BETWEEN_QUERIES,                // _secondsBetweenQueries
      USD_ETH_EXCHANGE_RATE * 100,            // _initialUsdEthRate
      USD_BTC_EXCHANGE_RATE * 100,            // _initialUsdBtcRate
      USD_LTC_EXCHANGE_RATE * 100,            // _initialUsdLtcRate
      EXCHANGE,                               // _exchange
      { from: ADMINISTRATOR, value: dataFeedReserve },
    )

      // TODO: DELETE
      .then(() => deployer.deploy(
        NavCalculator,
        DataFeed.address,
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        InvestorActions,
        DataFeed.address,
        { from: ADMINISTRATOR },
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
        { from: ADMINISTRATOR },
      ))

      .then(() => deployer.deploy(
        FundStorage,
        MANAGER,                            // _manager
        EXCHANGE,                           // _exchange
        FUND_NAME,                          // _name
        FUND_SYMBOL,                        // _symbol
        FUND_DECIMALS,                      // _decimals
        MIN_INITIAL_SUBSCRIPTION_USD * 100, // _minInitialSubscriptionUsd
        MIN_SUBSCRIPTION_USD * 100,         // _minSubscriptionUsd
        MIN_REDEMPTION_SHARES * 100,        // _minRedemptionShares,
        ADMIN_FEE * 100,                    // _adminFeeBps
        MGMT_FEE * 100,                     // _mgmtFeeBps
        PERFORM_FEE * 100,                  // _performFeeBps
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        FundLogic,
        DataFeed.address,               // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        NewNavCalculator,
        DataFeed.address,               // _dataFeed
        FundStorage.address,            // _fundStorage
        FundLogic.address,              // _fundLogic
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        NewFund,
        DataFeed.address,               // _dataFeed
        FundStorage.address,            // _fundStorage
        FundLogic.address,              // _fundLogic
        NewNavCalculator.address,       // _navCalculator
        { from: ADMINISTRATOR },
      ))
      .then(() => FundStorage.deployed())
      .then(_fundStorage => _fundStorage.setFund(Fund.address))
      .then(() => FundLogic.deployed())
      .then(_fundLogic => _fundLogic.setFund(Fund.address))
      .then(() => NewNavCalculator.deployed())
      .then(_newNavCalculator => _newNavCalculator.setFund(NewFund.address))
      .then(() => console.log('  Contract addresses:'))
      .then(() => console.log(`  - Fund               | ${Fund.address}`))
      .then(() => console.log(`  - InvestorActions    | ${InvestorActions.address}`))
      .then(() => console.log(`  - NAV                | ${NavCalculator.address}`))
      .then(() => console.log('    ================================================================'))
      .then(() => console.log(`  - DataFeed           | ${DataFeed.address}`))
      .then(() => console.log(`  - FundStorage        | ${FundStorage.address}`))
      .then(() => console.log(`  - FundLogic          | ${FundLogic.address}`))
      .then(() => console.log(`  - NewNAV             | ${NewNavCalculator.address}`))
      .then(() => console.log(`  - NewFund            | ${NewFund.address}`));
  } else {
    // Network-specific variables
    const NAV_SERVICE_URL = dataFeedInfo[network].navServiceUrl;
    const DATA_FEED_ADDRESS = dataFeedInfo[network].dataFeedAddress;

    // assume that DataFeed has already been deployed and has an updated value() property
    deployer.deploy(
      NavCalculator,
      DATA_FEED_ADDRESS,
      { from: ADMINISTRATOR },
    )
    
      // TODO: DELETE  
      .then(() => deployer.deploy(
        InvestorActions,
        DATA_FEED_ADDRESS,
        { from: ADMINISTRATOR },
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
        { from: ADMINISTRATOR },
      ))

      .then(() => deployer.deploy(
        FundStorage,
        MANAGER,                        // _manager
        EXCHANGE,                       // _exchange
        FUND_NAME,                      // _name
        FUND_SYMBOL,                    // _symbol
        FUND_DECIMALS,                  // _decimals
        MIN_INITIAL_SUBSCRIPTION_USD * 100, // _minInitialSubscriptionEth
        MIN_SUBSCRIPTION_USD * 100,     // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,          // _minRedemptionShares,
        ADMIN_FEE * 100,                // _adminFeeBps
        MGMT_FEE * 100,                 // _mgmtFeeBps
        PERFORM_FEE * 100,              // _performFeeBps
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        FundLogic,
        DATA_FEED_ADDRESS,              // _dataFeed
        FundStorage.address,            // _fundStorage
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        NewNavCalculator,
        DATA_FEED_ADDRESS,              // _dataFeed
        FundStorage.address,            // _fundStorage
        FundLogic.address,              // _fundLogic
        { from: ADMINISTRATOR },
      ))
      .then(() => deployer.deploy(
        NewFund,
        DATA_FEED_ADDRESS,              // _dataFeed
        FundStorage.address,            // _fundStorage
        FundLogic.address,              // _fundLogic
        NewNavCalculator.address,       // _navCalculator
        { from: ADMINISTRATOR },
      ))
      .then(() => FundStorage.deployed())
      .then(_fundStorage => _fundStorage.setFund(Fund.address))
      .then(() => FundLogic.deployed())
      .then(_fundLogic => _fundLogic.setFund(Fund.address))
      .then(() => NewNavCalculator.deployed())
      .then(_newNavCalculator => _newNavCalculator.setFund(NewFund.address))
      .then(() => console.log('  Contract addresses:'))
      .then(() => console.log(`  - Fund               | ${Fund.address}`))
      .then(() => console.log(`  - InvestorActions    | ${InvestorActions.address}`))
      .then(() => console.log(`  - NAV                | ${NavCalculator.address}`))
      .then(() => console.log(`  - DataFeed           | ${DataFeed.address}`))
      .then(() => console.log(`  - FundStorage        | ${FundStorage.address}`))
      .then(() => console.log(`  - FundLogic          | ${FundLogic.address}`))
      .then(() => console.log(`  - NewNAV             | ${NewNavCalculator.address}`))
      .then(() => console.log(`  - NewFund            | ${NewFund.address}`));
  }
};
