var DataFeed  = artifacts.require("./DataFeed.sol");
var NavCalculator  = artifacts.require("./NavCalculator.sol");
var InvestorActions = artifacts.require("./InvestorActions.sol");
var Fund = artifacts.require("./Fund.sol");

// Deployment constants
const managerInvestment = 1e17;

module.exports = function(deployer, network, accounts) {

  const useOraclize = network == "ropsten" ? true : false;
  const dataFeedReserve = network == "ropsten" ? 1e17 : 0;
  
  deployer.deploy(
    DataFeed,
    "nav-service",                    // _name
    useOraclize,                      // _useOraclize
    "json(http://9afaae62.ngrok.io/api/sandbox).totalPortfolioValueEth", // _queryUrl
    60,                               // _secondsBetweenQueries
    accounts[1],                      // _exchange
    {from: accounts[0], value: dataFeedReserve}
  ).then(() =>
    deployer.deploy(
      NavCalculator, 
      DataFeed.address
  )).then(() =>
    deployer.deploy(
      InvestorActions
  )).then(() =>
    deployer.deploy(
      Fund,
      accounts[1],                    // _exchange
      NavCalculator.address,          // _navCalculator
      InvestorActions.address,        // investorActions
      "Falcon",                       // _name
      "FALC",                         // _symbol
      4,                              // _decimals
      4e17,                           // _minInitialSubscriptionEth
      1e17,                           // _minSubscriptionEth
      1e17,                           // _minRedemptionShares,
      100,                            // _mgmtFeeBps
      2000,                           // _performFeeBps
      {from: accounts[0], value: managerInvestment}
  ));
};
