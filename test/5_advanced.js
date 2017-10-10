const DataFeed = artifacts.require('./DataFeed.sol');
const Fund = artifacts.require('./Fund.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');

/*
  Test contract behavior when there is a large lists of investors.
  To customize the number of investors, run `testrpc -b 1 -a <NUM_OF_INVESTORS>`
  To customize testrpc gas limit, run `testrpc -b 1 -l <GAS_LIMIT_IN_HEX>`

  Default # of investor accounts:         10
  Default gas limit:                      0x47E7C4 (4712388)
  Default gas price:                      20000000000

  Tests currently fail at maximum of 11 investors
*/

// helpers
const getBalancePromise = address => web3.eth.getBalancePromise(address);
const weiToNum = wei => web3.fromWei(wei, 'ether');
const ethToWei = eth => web3.toWei(eth, 'ether');
const diffInWei = (a, b) => weiToNum(a) - weiToNum(b);
const gasToWei = gas => gas * 1e11;

contract('Advanced', (accounts) => {
<<<<<<< HEAD

  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];

  // test parameters
=======
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
>>>>>>> fixes to test #5
  const GAS_AMT = 500000;
  const USD_ETH = 300;
  const MIN_INITIAL_SUBSCRIPTION = 5;
  const MIN_SUBSCRIPTION = 5;
  const MIN_REDEMPTION_SHARES = 1000;
  const MGMT_FEE = 1;
  const PERFORM_FEE = 20;
  const SECONDS_IN_YEAR = 31536000;
<<<<<<< HEAD
  
  const investors = accounts.slice(2);
=======
  const PERFORM_FEE_BPS = 2000;

  let fund;
  let navCalculator;
  let valueFeed;
  let investorActions;
  const investors = accounts.slice(2);
  const getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber();
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToWei = eth => web3.toWei(eth, 'ether');
>>>>>>> fixes to test #5

  // contract instances
  let dataFeed, fund, navCalculator, investorActions;

  before(() => DataFeed.new(
    'nav-service',                          // _name
    false,                                  // _useOraclize
    '[NOT USED]',                           // _queryUrl
    300,                                    // _secondsBetweenQueries
    USD_ETH * 100,                          // _initialExchangeRate
    EXCHANGE,                               // _exchange
    { from: MANAGER, value: 0 }
  )
    .then(instance => {
      dataFeed = instance;
      return Promise.all([
        NavCalculator.new(dataFeed.address, { from: MANAGER }),
        InvestorActions.new(dataFeed.address, { from: MANAGER })
      ]);
    })
    .then((contractInstances) => {
      [navCalculator, investorActions] = contractInstances;
      return Fund.new(
        EXCHANGE,                           // _exchange
        navCalculator.address,              // _navCalculator
        investorActions.address,            // investorActions
        dataFeed.address,                   // _dataFeed
        "TestFund",                         // _name
        "TEST",                             // _symbol
        4,                                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION),         // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,              // _minRedemptionShares,
        MGMT_FEE * 100,                     // _mgmtFeeBps
        PERFORM_FEE * 100,                  // _performFeeBps
        { from: MANAGER }
      );
    })
    .then((fundInstance) => {
      fund = fundInstance;
      return Promise.all([
        navCalculator.setFund(fund.address),
        investorActions.setFund(fund.address)
      ]);
    })
    .then(() => Promise.all([
      navCalculator.fundAddress.call({ from: MANAGER }),
      investorActions.fundAddress.call({ from: MANAGER }),
      dataFeed.updateWithExchange(100)
    ]))
    .then(() => {
      return Promise.all(investors.map(acct => fund.modifyAllocation(acct, ethToWei(30))));
    })
    .catch(err => console.log('**** BEFORE ERROR: ', err)));

  beforeEach((done) => {
    console.log('**** Resetting subscription ****');
    Promise.all(investors.map(acct => fund.requestSubscription({ from: acct, value: ethToWei(MIN_INITIAL_SUBSCRIPTION) })))
      .then(() => {
        // Gas for subscribing a single investor ~=81800
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, i) => {
          assert(weiToNum(val[1]) !== 0, 'Subscription Request failed');
        });
        return fund.fillAllSubscriptionRequests();
      })
      .then(() => {
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, i) => {
          assert.equal(weiToNum(val[1]), 0, 'Subscription failed: incorrect ethPendingSubscription');
          assert(weiToNum(val[2]) !== 0, 'Subscription failed: incorrect balance');
        });
      })
      .then(() => { done(); })
      .catch(console.error);
  });

  // Gas for redeeming a single investor ~=399000
  it('should redeem all redemption requests', (done) => {
    fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(99), gas: GAS_AMT })
      .then(() => {
        return Promise.all(investors.map(acct => fund.requestRedemption(MIN_REDEMPTION_SHARES, { from: acct })));
      })
      .then(() => fund.fillAllRedemptionRequests())
      .then(() => {
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, index) => {
          assert.equal(+val[3], 0, `redemption index: ${index}, addr: ${val} failed to process`);
          assert(weiToNum(val[4]) > 0, 'Redemption failed due to sendToExchange');
        });
      })
      .then(() => { done(); })
      .catch(done);
  });

  // Gas for liquidating a single investor ~=414700
  it('should liquidate all investors', (done) => {
    fund.liquidateAllInvestors()
      .then(() => {
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, index) => {
          assert.equal(weiToNum(val[2]), 0, `liquidation index: ${index}, addr: ${val} failed to process`);
          assert(weiToNum(val[4]) > 0, 'Liquidation failed due to sendToExchange');
        });
      })
      .then(() => { done(); })
      .catch(done);
  });

  // Test when fund balance lowers during redeemAll
  // (currently failing because sendToExchange is not disabled during redeemAll)
  xit('should not let exchange balance change affect redeemAll', (done) => {
    Promise.all(investors.map(acct => fund.requestRedemption(ethToWei(5), { from: acct })))
      .then(() => {
        fund.fillAllRedemptionRequests();
        return fund.sendToExchange(ethToWei(80));
      })
      .then(() => {
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, index) => {
          assert.equal(+val[3], 0, 'Redemption failed due to sendToExchange');
          assert(weiToNum(val[4]) > 0, 'Redemption failed due to sendToExchange');
        });
      })
      .then(() => { done(); })
      .catch(done);
  });

  // Test when fund balance lowers during liquidateAll
  // (currently failing because sendToExchange is not disabled during liquidateAll)
  xit('should not let exchange balance change affect liquidateAll', (done) => {
    fund.liquidateAllInvestors();
    fund.sendToExchange(ethToWei(60))
      .then(() => {
        return Promise.all(investors.map(acct => fund.getInvestor(acct)));
      })
      .then((_values) => {
        _values.forEach((val, index) => {
          assert.equal(weiToNum(val[2]), 0, 'Liquidation failed due to sendToExchange');
          assert(weiToNum(val[4]) > 0, 'Liquidation failed due to sendToExchange');
        });
      })
      .then(() => { done(); })
      .catch(done);
  });
});
