const path = require('path');
const Promise = require('bluebird');

const DataFeed = artifacts.require('./DataFeed.sol');
const Fund = artifacts.require('./Fund.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');

const scriptName = path.basename(__filename);

if (typeof web3.eth.getAccountsPromise === 'undefined') {
  Promise.promisifyAll(web3.eth, { suffix: 'Promise' });
}

// helpers
const getBalancePromise = address => web3.eth.getBalancePromise(address);
const weiToNum = wei => web3.fromWei(wei, 'ether');
const ethToWei = eth => web3.toWei(eth, 'ether');
const diffInWei = (a, b) => weiToNum(a) - weiToNum(b);
const gasToWei = gas => gas * 1e11;

contract('FundActions', (accounts) => {
  const OWNER = accounts[0];
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const MIN_INVESTOR = accounts[2];
  const MID_INVESTOR = accounts[3];
  const MAX_INVESTOR = accounts[4];
  const INVESTOR1 = accounts[5];
  const INVESTOR2 = accounts[6];
  const INVESTOR_COUNT = 5;

  // test parameters
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
  const USD_ETH_BASIS = 30000;
  const ETH_INCREMENT = 1;
  const PRECISION = 1000000000;

  // test for boundaries and a mid value
  const investors = [
    { name: 'Subscribe for minimum amount', investor: MIN_INVESTOR, amount: MIN_INITIAL_SUBSCRIPTION },
    { name: 'Subscribe for mid amount', investor: MID_INVESTOR, amount: (MIN_INITIAL_SUBSCRIPTION + INVESTOR_ALLOCATION) / 2 },
    { name: 'Subscribe for max amount', investor: MAX_INVESTOR, amount: INVESTOR_ALLOCATION }
  ];

  // contract instances
  let dataFeed;
  let fund;
  let navCalculator;
  let investorActions;

  before(() => DataFeed.new(
    '[NOT USED]',                           // _queryUrl
    SECONDS_BETWEEN_QUERIES,                // _secondsBetweenQueries
    USD_ETH_EXCHANGE_RATE * 100,            // _initialUsdEthRate
    USD_BTC_EXCHANGE_RATE * 100,            // _initialUsdBtcRate
    USD_LTC_EXCHANGE_RATE * 100,            // _initialUsdLtcRate
    EXCHANGE,                               // _exchange
    { from: OWNER, value: web3.toWei(0.5,'ether') }
  )
    .then((instance) => {
      console.log(`  ****** START TEST [ ${scriptName} ]  *******`);
      dataFeed = instance;
      return Promise.all([
        NavCalculator.new(dataFeed.address, { from: OWNER }),
        InvestorActions.new(dataFeed.address, { from: OWNER })
      ]);
    })
    .then((contractInstances) => {
      [navCalculator, investorActions] = contractInstances;
      return Fund.new(
        MANAGER,                            // _manager
        EXCHANGE,                           // _exchange
        navCalculator.address,              // _navCalculator
        investorActions.address,            // investorActions
        dataFeed.address,                   // _dataFeed
        'TestFund',                         // _name
        'TEST',                             // _symbol
        4,                                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION),         // _minSubscriptionEth
        MIN_REDEMPTION_SHARES,              // _minRedemptionShares,
        ADMIN_FEE * 100,                    // _adminFeeBps
        MGMT_FEE * 100,                     // _mgmtFeeBps
        PERFORM_FEE * 100,                  // _performFeeBps
        USD_ETH_BASIS,                      // _managerUsdEthBasis
        { from: OWNER }
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
      navCalculator.fundAddress.call({ from: OWNER }),
      investorActions.fundAddress.call({ from: OWNER }),
      dataFeed.updateWithExchange(100)
    ]))
    .then(([navFund, investorActionsFund]) => {
      assert.equal(navFund, fund.address, 'Incorrect fund address in navCalculator');
      assert.equal(investorActionsFund, fund.address, 'Incorrect fund address in investorActionsFund');
    })
    .catch(err => console.log('**** BEFORE ERROR: ', err)));

  let didRunMinMax = false;

  investors.forEach((investorObj) => {
    const { name, investor, subscribeAmount } = investorObj;
    let allocation;

    describe(`Investor subscription: ${name}`, () => {
      it('should get investor information from investor address', () => fund.getInvestor(investor)
        .then((_info) => {
          assert.equal(weiToNum(_info[0]), 0, 'Incorrect ethTotalAllocation amount');
          assert.equal(weiToNum(_info[1]), 0, 'Incorrect ethPendingSubscription amount');
          assert.equal(_info[2], 0, 'Incorrect sharedOwned amount');
          assert.equal(_info[3], 0, 'Incorrect sharesPendingRedemption amount');
          assert.equal(weiToNum(_info[4]), 0, 'Incorrect ethPendingWithdrawal amount');
        }));

      // MANAGER ACTION: Modify allocation
      it('should add input amount to ethTotalAllocation', () => {
        const amt = ethToWei(INVESTOR_ALLOCATION);
        return fund.modifyAllocation.call(investor, amt, { from: MANAGER })
          .then(success => assert.isTrue(success))
          .then(() => fund.modifyAllocation(investor, amt, { from: MANAGER }))
          .then(() => fund.getAvailableAllocation(investor))
          .then((_allocation) => {
            allocation = _allocation;
            return fund.getInvestor(investor);
          })
          .then((_info) => {
            assert.equal(_info[0].toNumber(), amt, 'Incorrect reset to allocation');
            assert.equal(_info[0].toNumber(), allocation, 'Allocation and result of getAvailableAllocation doesn\'t match');
          })
          .catch(err => console.log(err));
      });
    });

    // run one time only
    if (!didRunMinMax) {
      describe('throw errors for invalid subscription requests', () => {
        // INVESTOR ACTION: Subscription Requests
        it('should reject subscription requests lower than minInitialSubscriptionEth', () => {
          const amt = MIN_INITIAL_SUBSCRIPTION - ETH_INCREMENT;
          return fund.requestSubscription(USD_ETH_BASIS, { from: investor, value: ethToWei(amt), gas: GAS_AMT })
            .then(
              () => assert.throw('should not have accepted request lower than minInitialSubscriptionEth'),
              e => assert.isAtLeast(e.message.indexOf('revert'), 0)
            ).catch(console.warn);
        });

        it('should reject subscription requests higher than allocation', () => {
          const amt = INVESTOR_ALLOCATION + ETH_INCREMENT;
          return fund.requestSubscription(USD_ETH_BASIS, { from: investor, value: ethToWei(amt), gas: GAS_AMT })
            .then(
              () => assert.throw('should not have accepted request amount higher than allocation'),
              e => assert.isAtLeast(e.message.indexOf('revert'), 0)
            ).catch(console.warn);
        });
      });

      didRunMinMax = true;
    }

    describe(`handle subscription life cycle: ${name}`, () => {
      const amt = INVESTOR_ALLOCATION;

      it('should make subscription request given valid amount', () => fund.requestSubscription(USD_ETH_BASIS, { from: investor, value: ethToWei(amt), gas: GAS_AMT })
        .then(() => fund.getInvestor(investor))
        .then(_info => assert.equal(weiToNum(_info[1]), amt, 'Subscription rejected on valid subscription requests')));

      // INVESTOR ACTION: Cancel Subscription Requests
      it('should allow canceling existing subscription request', () => fund.cancelSubscription({ from: investor })
        .then(() => fund.getInvestor(investor))
        .then(_info => assert.equal(weiToNum(_info[1]), 0, 'Subscription rejected on valid subscription requests')));

      // INVESTOR ACTION: Withdraw payments
      it('should allow withdrawal of payments', () => {
        let initialBalance;
        let gasUsed = 0;
        return fund.cancelSubscription({ from: investor })
          .then(() => fund.getInvestor(investor))
          .then((_info) => {
            assert.equal(weiToNum(_info[1]), 0, 'Subscription rejected on valid subscription requests');
            assert.equal(weiToNum(_info[4]), INVESTOR_ALLOCATION, 'Cancel did not increase withdaw payments balance');
          })
          .then(() => getBalancePromise(investor))
          .then(_bal => initialBalance = _bal)
          .then(() => fund.withdrawPayment({ from: investor }))
          .then(txObj => gasUsed += txObj.receipt.gasUsed)
          .then(() => fund.getInvestor(investor))
          .then((_info) => {
            assert.equal(weiToNum(_info[4]), 0, 'Withdraw payments balance was not reduced');
            return getBalancePromise(investor);
          })
          .then(_finalBal => assert.equal(
            Math.round((+initialBalance + +ethToWei(amt)) / 1000000), Math.round((+_finalBal + gasToWei(gasUsed)) / 1000000),
            'Incorrect amount returned to investor'
          ));
      });
    });
    // end of investor.foreach
  });

  describe('cancelSubscription', () => {
    it('should allocate the investor and investor can subscribe', () => {
      const amt = ethToWei(INVESTOR_ALLOCATION);
      return fund.modifyAllocation(INVESTOR1, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR1))
        .then(_info => assert.equal(_info[0].toNumber(), amt, 'Incorrect reset to allocation'))
        .then(() => fund.requestSubscription(USD_ETH_BASIS, { from: INVESTOR1, value: amt, gas: GAS_AMT }))
        .then(() => fund.getInvestor(INVESTOR1))
        .then(_info => assert.equal(_info[1], amt, 'Subscription rejected on valid subscription requests'));
    });

    // INVESTOR ACTION: Cancel Subscription Requests
    it('should allow canceling existing subscription request', () => fund.cancelSubscription.call({ from: INVESTOR1 })
      .then(success => assert.isTrue(success))
      .then(() => fund.cancelSubscription({ from: INVESTOR1 }))
      .then(() => fund.getInvestor(INVESTOR1))
      .then(_info => assert.equal(weiToNum(_info[1]), 0, 'Cancel request did not change amount')));
  });


  describe('fund.totalEthPendingSubscription', () => {
    const added = MIN_INITIAL_SUBSCRIPTION + ((INVESTOR_ALLOCATION - MIN_INITIAL_SUBSCRIPTION) * Math.random());

    // MANAGER ACTION: Get total subscriptions
    it('should get correct amount of total subscription requests | calculate incremental change', () => {
      let initialAmt;
      return fund.totalEthPendingSubscription()
        .then(_bal => initialAmt = _bal)
        .then(() => fund.modifyAllocation(INVESTOR1, ethToWei(added), { from: MANAGER }))
        .then(() => fund.requestSubscription(USD_ETH_BASIS, { from: INVESTOR1, value: ethToWei(added), gas: GAS_AMT }))
        .then(() => fund.totalEthPendingSubscription())
        .then(_finalBal => assert.equal(+weiToNum(_finalBal), added + initialAmt, 'Outputs incorrect amount of total subscription'));
    });

    // MANAGER ACTION: Get total subscriptions
    it('should get correct amount of total subscription requests', () => fund.totalEthPendingSubscription()
      .then(_finalBal => assert.equal(weiToNum(_finalBal), added, 'Outputs incorrect amount of total subscription')));
  });

  describe('Manager: Subscribe Investors', () => {
    // MANAGER ACTION: Process subscriptions
    it('should allow subscribing a single investor', () => {
      let before;
      let exchange1;
      let totalSupply1;
      let totalEthPendingSubscription1;
      let placeholder;
      let after;
      let exchange2;
      let totalSupply2;
      let totalEthPendingSubscription2;

      const params = { from: MANAGER };

      Promise.all([
        fund.getInvestor(INVESTOR1, params),
        getBalancePromise(EXCHANGE),
        fund.totalSupply(params),
        fund.totalEthPendingSubscription(params),
        fund.subscribeInvestor(INVESTOR1, params)
      ])
        .then((_values) => {
          [before, exchange1, totalSupply1, totalEthPendingSubscription1, placeholder] = _values;
          return Promise.all([
            fund.getInvestor(INVESTOR1),
            getBalancePromise(EXCHANGE),
            fund.totalSupply(),
            fund.totalEthPendingSubscription()
          ]);
        })
        .then((_results) => {
          [after, exchange2, totalSupply2, totalEthPendingSubscription2] = _results;
          return fund.ethToShares(before[1]);
        })
        .then((_shares) => {
          assert.equal(parseInt(after[1], 10), 0, 'subscription failed to process');
          assert.equal(after[2] - before[2], parseInt(_shares, 10), 'balance does not increase by the amount of tokens');
          assert.equal(
            diffInWei(totalEthPendingSubscription1, totalEthPendingSubscription2), weiToNum(before[1]),
            'totalEthPendingSubscription does not decrease by the amount of ether'
          );
          assert.equal(totalSupply2 - totalSupply1, _shares, 'totalSupply does not increase by the amount of tokens');
          assert.equal(
            Math.round(diffInWei(exchange2, exchange1) * PRECISION), Math.round(weiToNum(before[1]) * PRECISION),
            'exchange balance does not increase by amount of ether'
          );
        })
        .catch(err => console.error(err));
    });

    // MANAGER ACTION: Process multiple subscriptions
    it('should allow subscribing all investors', () => {
      let before;
      let exchange1;
      let totalSupply1;
      let totalEthPendingSubscription1;
      let placeholder;
      let after;
      let exchange2;
      let totalSupply2;
      let totalEthPendingSubscription2;

      const params = { from: MANAGER };

      return Promise.all(investors.map(investorObj =>
        fund.modifyAllocation(investorObj.investor, ethToWei(investorObj.amount), params)))
        .then(() => Promise.all(investors.map(investorObj =>
          fund.getInvestor(investorObj.investor, params))))
        .then(gotInvestor => Promise.all(investors.map(investorObj =>
          fund.requestSubscription(USD_ETH_BASIS, { from: investorObj.investor, value: ethToWei(investorObj.amount), gas: GAS_AMT }))))
        // .then(() => fund.calcNav(params))
        .then(() => fund.fillAllSubscriptionRequests(params))
        .then(() => Promise.all(investors.map(investorObj => fund.getInvestor(investorObj.investor))))
        .then((_values) => {
          _values.forEach(val => assert.equal(weiToNum(val[1]), 0, 'Subscription amount did not change'));
          _values.forEach(val => assert.isAbove(weiToNum(val[2]), 0, 'Holding amount did not change'));
        })
        .catch(console.warn);
    });

    // end describe manager
  });

  describe('Investor: handle redemption requests', () => {
    // INVESTOR ACTION: Request redemption
    it('should reject redemption requests lower than minRedemptionShares', () => {
      const amt = MIN_REDEMPTION_SHARES - ETH_INCREMENT;
      return fund.requestRedemption(amt, { from: MIN_INVESTOR })
        .then(
          () => assert.throw('should not have accepted request lower than min redemption shares'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0)
        ).catch(console.warn);
    });

    it('should reject redemption requests higher than sharesOwned', () => {
      let amt;
      return fund.getInvestor(MIN_INVESTOR)
        .then((_shares) => {
          amt = _shares[2] + ETH_INCREMENT;
          return fund.requestRedemption(amt, { from: MIN_INVESTOR });
        })
        .then(
          () => assert.throw('should not have accepted request higher than amount of shares owned'),
          e => assert.isAtLeast(e.message.indexOf('revert'), 0)
        ).catch(console.warn);
    });

    it('should let investors request to redeem a valid amount of shares', () => {
      let amt;
      return fund.getInvestor(MIN_INVESTOR)
        .then((_shares) => {
          amt = _shares[2];
          return fund.requestRedemption(_shares[2], { from: MIN_INVESTOR });
        })
        .then(() => fund.getInvestor(MIN_INVESTOR))
        .then(_info => assert.equal(+_info[3], +amt, 'Redemption rejected on valid requests'))
        .catch(console.warn);
    });

    // INVESTOR ACTION: Cancel redemption request
    it('should allow canceling existing redemption requests', () => fund.cancelRedemption.call({ from: MIN_INVESTOR })
      .then((success) => {
        assert.isTrue(success);
        return fund.cancelRedemption({ from: MIN_INVESTOR });
      })
      .then(() => fund.getInvestor(MIN_INVESTOR))
      .then(_info => assert.equal(weiToNum(_info[3]), 0, 'Cancellation rejected on valid requests'))
      .catch(console.warn));
  });


  describe('Manager: handle redemption requests', () => {
    // MANAGER ACTION: Process redemption
    it('should get correct amount of total redemption requests', () => {
      const added = MIN_REDEMPTION_SHARES;
      let redemption1;
      let redemption2;
      return fund.requestRedemption(added, { from: MIN_INVESTOR })
        .then(() => fund.totalSharesPendingRedemption())
        .then(_bal => redemption1 = _bal)
        .then(() => fund.requestRedemption(added, { from: MID_INVESTOR }))
        .then(() => fund.totalSharesPendingRedemption())
        .then((_finalBal) => {
          redemption2 = _finalBal;
          assert.equal(
            +redemption2, +added + +redemption1,
            'outputs incorrect amount of total redemptions'
          );
          return fund.requestRedemption(added, { from: MAX_INVESTOR });
        });
    });

    it('should redeem a single investor', () => {
      let before;
      let bal1;
      let totalEthPendingWithdrawal1;
      let investorBal1;
      let placeholder;
      let after;
      let bal2;
      let totalEthPendingWithdrawal2;
      let investorBal2;
      let totalSupply1;
      let totalSupply2;

      return fund.totalEthPendingRedemption()
        .then(ethNeeded => fund.remitFromExchange({ from: EXCHANGE, value: ethNeeded }))
        .then(() => Promise.all([
          fund.getInvestor(MIN_INVESTOR),
          fund.totalSupply(),
          fund.totalEthPendingWithdrawal(),
          fund.redeemInvestor(MIN_INVESTOR)]))
        .then((_values) => {
          [before, totalSupply1, totalEthPendingWithdrawal1, placeholder] = _values;
          return Promise.all([
            fund.getInvestor(MIN_INVESTOR),
            fund.totalSupply(),
            fund.totalEthPendingWithdrawal()
          ]);
        })
        .then((_results) => {
          [after, totalSupply2, totalEthPendingWithdrawal2] = _results;
          return fund.sharesToEth(before[3]);
        })
        .then((_amt) => {
          assert.equal(weiToNum(after[3]), 0, 'redemption failed to process');
          assert.equal(
            Math.round(diffInWei(after[4], before[4])), Math.round(weiToNum(_amt)),
            'ethPendingWithdrawal did not increase by the amount of ether'
          );
          assert.equal(
            Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(_amt)),
            'totalEthPendingWithdrawal does not increase by the amount of ether'
          );
          assert.equal(totalSupply1 - totalSupply2, before[3], 'totalSupply does not decrease by the amount of tokens');
        })
        .catch(console.log);
    });

    // NOTE: disabling due to truffle 4.0.0 bug / errors
    xit('should redeem all redemption requests', () => {
      let redeemRequestAmount;
      let withdrawPaymentsAmount;
      return fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(10 * MIN_REDEMPTION_SHARES), gas: GAS_AMT })
        .then(() => Promise.all(investors.map(investorObj => fund.getInvestor(investorObj.investor))))
        .then((gotInvestors) => {
          redeemRequestAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[3].toNumber(), 0);
          withdrawPaymentsAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[4].toNumber(), 0);
          assert.isAbove(redeemRequestAmount, 0, 'there are no outstanding redemption requests');
        })
        .then(() => getBalancePromise(fund.address))
        .then(_bal => console.log('Fund balance: ', +weiToNum(_bal)))
        .then(() => fund.fillAllRedemptionRequests.call())
        .then(success => assert.isTrue(success, 'fillAllRedemptionRequests failed'))
        .then(() => fund.fillAllRedemptionRequests({ from: MANAGER, gas: GAS_AMT }))
        .then(() => Promise.all(investors.map(investorObj => fund.getInvestor(investorObj.investor))))
        .then((gotInvestors) => {
          redeemRequestAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[3].toNumber(), 0);
          assert.equal(redeemRequestAmount, 0, 'there are still outstanding redemption requests');
          const newWithdrawPaymentsAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[4].toNumber(), 0);
          assert.isAbove(newWithdrawPaymentsAmount, withdrawPaymentsAmount, 'withdraw payments amounts did not increase');
        });
    });
  });

  describe('Manager: handle liquidate investor', () => {
    // MANAGER ACTION: Liquidate investor
    it('should liquidate a subscribed investor', () => {
      let before;
      let bal1;
      let totalEthPendingWithdrawal1;
      let investorBal1;
      let placeholder;
      let after;
      let bal2;
      let totalEthPendingWithdrawal2;
      let investorBal2;
      let totalSupply1;
      let totalSupply2;

      const amt = ethToWei(INVESTOR_ALLOCATION);

      return fund.modifyAllocation(INVESTOR2, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(() => getBalancePromise(INVESTOR2))
        .then(() => fund.requestSubscription(USD_ETH_BASIS, { from: INVESTOR2, value: amt, gas: GAS_AMT }))
        .then(() => fund.subscribeInvestor(INVESTOR2, { from: MANAGER }))
        .then(() => fund.remitFromExchange({ from: EXCHANGE, value: amt, gas: GAS_AMT }))
        .then(() => Promise.all([
          fund.getInvestor(INVESTOR2), fund.totalSupply(), fund.totalEthPendingWithdrawal(),
          fund.liquidateInvestor(INVESTOR2, { from: MANAGER })]))
        .then((_values) => {
          [before, totalSupply1, totalEthPendingWithdrawal1, placeholder] = _values;
          return Promise.all([
            fund.getInvestor(INVESTOR2), fund.totalSupply(), fund.totalEthPendingWithdrawal()]);
        })
        .then((_results) => {
          [after, totalSupply2, totalEthPendingWithdrawal2] = _results;
          return fund.sharesToEth(before[2]);
        })
        .then((_amt) => {
          assert.equal(weiToNum(after[2]), 0, 'liquidation failed to process');
          assert.equal(diffInWei(after[4], before[4]), weiToNum(_amt), 'ethPendingWithdrawal does not increase by the amount of ether');
          assert.equal(
            Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(after[4])),
            'totalEthPendingWithdrawal does not increase by the amount of ether'
          );
          assert.equal(
            Math.round(diffInWei(totalSupply1, totalSupply2)), Math.round(weiToNum(before[2])),
            'totalSupply does not decrease by the amount of tokens'
          );
        })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], amt, 'liquidate investor withdrawal amount is incorrect'))
        .then(() => fund.withdrawPayment({ from: INVESTOR2 }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], 0, 'liquidate investor withdraw payment failed'));
    });

    it('should liquidate an investor who has requested subscription', () => {
      let before;
      let bal1;
      let totalEthPendingWithdrawal1;
      let investorBal1;
      let placeholder;
      let after;
      let bal2;
      let totalEthPendingWithdrawal2;
      let investorBal2;

      const amt = ethToWei(INVESTOR_ALLOCATION);

      return fund.modifyAllocation(INVESTOR2, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(() => getBalancePromise(INVESTOR2))
        .then(() => fund.requestSubscription(USD_ETH_BASIS, { from: INVESTOR2, value: amt, gas: GAS_AMT }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[1], amt, 'liquidate investor: requestSubscription failed'))
        .then(() => fund.liquidateInvestor(INVESTOR2, { from: MANAGER }))
        .then(txObj => assert.equal(txObj.logs[0].event, 'LogLiquidation', 'LogLiquidation failed'))
        .then(() => fund.getInvestor(INVESTOR2))
        .then((_gotInvestor) => {
          assert.equal(_gotInvestor[1], 0, 'subscription request amount did not change');
          assert.equal(_gotInvestor[4], amt, 'liquidate investor withdrawal amount is incorrect');
        })
        .then(() => fund.withdrawPayment({ from: INVESTOR2 }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], 0, 'liquidate investor withdraw payment failed'));
    });
  });

  describe('Contract Maintenance', () => {
    // Contract Maintenance
    it('should fetch a list of investor addresses', () => fund.getInvestorAddresses()
      .then(_addresses => assert.equal(_addresses.length, INVESTOR_COUNT, 'list does not include all investors')));

    it('should modify exchange address', () => fund.setExchange(accounts[9])
      .then(() => fund.exchange.call())
      .then(_exchange => assert.equal(_exchange, accounts[9], 'wrong exchange address'))
      .then(() => fund.setExchange(EXCHANGE)));

    it('should modify navCalculator address', () => fund.setNavCalculator(accounts[9])
      .then(() => fund.navCalculator.call())
      .then(_calculator => assert.equal(_calculator, accounts[9], 'wrong navCalculator address'))
      .then(() => fund.setNavCalculator(navCalculator.address)));

    it('should modify investorActions address', () => fund.setInvestorActions(accounts[9])
      .then(() => fund.investorActions.call())
      .then(_investorActions => assert.equal(_investorActions, accounts[9], 'wrong investorActions address'))
      .then(() => fund.setInvestorActions(investorActions.address)));
  });
});
