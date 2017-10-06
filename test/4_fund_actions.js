const Promise = require('bluebird');

const DataFeed = artifacts.require("./DataFeed.sol");
const Fund = artifacts.require('./Fund.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');

if (typeof web3.eth.getAccountsPromise === "undefined") {
  Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

// helpers
const getBalancePromise = address => web3.eth.getBalancePromise(address);
const weiToNum = wei => web3.fromWei(wei, 'ether');
const ethToWei = eth => web3.toWei(eth, 'ether');
const diffInWei = (a, b) => weiToNum(a) - weiToNum(b);
const gasToWei = gas => gas * 1e11;

contract('Fund Actions', (accounts) => {

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
  const MIN_INITIAL_SUBSCRIPTION = 20;
  const INVESTOR_ALLOCATION = 21;
  const MIN_SUBSCRIPTION = 5;
  const MIN_REDEMPTION_SHARES = 5;
  const ETH_INCREMENT = 0.1;
  const PRECISION = 1000000000;

  // test for boundaries and a mid value
  const investors = [
    { name: 'Subscribe for minimum amount', investor: MIN_INVESTOR, amount: MIN_INITIAL_SUBSCRIPTION },
    { name: 'Subsribe for mid amount', investor: MID_INVESTOR, amount: (MIN_INITIAL_SUBSCRIPTION + INVESTOR_ALLOCATION) / 2 },
    { name: 'Subscribe for max amount', investor: MAX_INVESTOR, amount: INVESTOR_ALLOCATION },
  ];

  // contract instances
  let dataFeed, fund, navCalculator, investorActions;

  before(() => DataFeed.new(
    'nav-service',                    // _name
    false,                      // _useOraclize
    'json(http://9afaae62.ngrok.io/api/sandbox).totalPortfolioValueEth', // _queryUrl
    300,                              // _secondsBetweenQueries
    EXCHANGE,                      // _exchange
    { from: MANAGER, value: 0 }
  )
    .then(instance => {
      dataFeed = instance;
      return Promise.all([
        NavCalculator.new(dataFeed.address, { from: MANAGER }),
        InvestorActions.new({ from: MANAGER })
      ]);
    })
    .then((contractInstances) => {
      [navCalculator, investorActions] = contractInstances;
      return Fund.new(
        EXCHANGE,                           // _exchange
        navCalculator.address,              // _navCalculator
        investorActions.address,            // investorActions
        "TestFund",                         // _name
        "TEST",                             // _symbol
        4,                                  // _decimals
        ethToWei(MIN_INITIAL_SUBSCRIPTION), // _minInitialSubscriptionEth
        ethToWei(MIN_SUBSCRIPTION),         // _minSubscriptionEth
        ethToWei(MIN_REDEMPTION_SHARES),    // _minRedemptionShares,
        100,                                // _mgmtFeeBps
        0,                                  // _performFeeBps
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
      investorActions.fundAddress.call({ from: MANAGER })
    ]))
    .then(([navFund, investorActionsFund]) => {
      assert.equal(navFund, fund.address, 'Incorrect fund address in navCalculator');
      assert.equal(investorActionsFund, fund.address, 'Incorrect fund address in investorActionsFund');
    })
    .catch(err => console.log('**** BEFORE ERROR: ', err)));

  let didRunMinMax = false;

  investors.forEach((investorObj) => {
    const { name, investor, subscribeAmount } = investorObj;

    describe(`Investor subscription: ${name}`, () => {

      it('should get investor information from investor address', () =>
        fund.getInvestor(investor)
          .then((_info) => {
            assert.equal(weiToNum(_info[0]), 0, 'Incorrect ethTotalAllocation amount');
            assert.equal(weiToNum(_info[1]), 0, 'Incorrect ethPendingSubscription amount');
            assert.equal(weiToNum(_info[2]), 0, 'Incorrect balance amount');
            assert.equal(weiToNum(_info[3]), 0, 'Incorrect sharesPendingRedemption amount');
            assert.equal(weiToNum(_info[4]), 0, 'Incorrect ethPendingWithdrawal amount');
          })
      );

      // MANAGER ACTION: Modify allocation
      it('should add input amount to ethTotalAllocation', () => {
        const amt = ethToWei(INVESTOR_ALLOCATION);
        return fund.modifyAllocation.call(investor, amt, { from: MANAGER })
          .then(success => assert.isTrue(success))
          .then(() => fund.modifyAllocation(investor, amt, { from: MANAGER }))
          .then(() => fund.getInvestor(investor))
          .then((_info) => assert.equal(_info[0].toNumber(), amt, 'Incorrect reset to allocation'))
          .catch(err => console.log(err));
      });

    });

    // run one time only
    if (!didRunMinMax) {
      describe('throw errors for invalid subscription requests', () => {

        // INVESTOR ACTION: Subscription Requests
        it('should reject subscription requests lower than minInitialSubscriptionEth', () => {
          const amt = MIN_INITIAL_SUBSCRIPTION - ETH_INCREMENT;
          return fund.requestSubscription({ from: investor, value: ethToWei(amt), gas: GAS_AMT })
            .then(
            () => assert.throw('should not have accepted request lower than minInitialSubscriptionEth'),
            e => assert.isAtLeast(e.message.indexOf('invalid opcode'), 0))
            .catch(console.warn);
        });

        it('should reject subscription requests higher than allocation', () => {
          const amt = INVESTOR_ALLOCATION + ETH_INCREMENT;
          return fund.requestSubscription({ from: investor, value: ethToWei(amt), gas: GAS_AMT })
            .then(
            () => assert.throw('should not have accepted request amount higher than allocation'),
            e => assert.isAtLeast(e.message.indexOf('invalid opcode'), 0))
            .catch(console.warn);
        });
      });

      didRunMinMax = true;
    }

    describe(`handle subscription life cycle: ${name}`, () => {
      const amt = INVESTOR_ALLOCATION;

      it('should make subscription request given valid amount', () => {
        return fund.requestSubscription({ from: investor, value: ethToWei(amt), gas: GAS_AMT })
          .then(() => fund.getInvestor(investor))
          .then(_info => assert.equal(weiToNum(_info[1]), amt, 'Subscription rejected on valid subscription requests'));
      });

      // INVESTOR ACTION: Cancel Subscription Requests
      it('should allow canceling existing subscription request', () => {
        return fund.cancelSubscription({ from: investor })
          .then(() => fund.getInvestor(investor))
          .then((_info) => assert.equal(weiToNum(_info[1]), 0, 'Subscription rejected on valid subscription requests'));
      });

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
          .then((txObj) => gasUsed += txObj.receipt.gasUsed)
          .then(() => fund.getInvestor(investor))
          .then((_info) => {
            assert.equal(weiToNum(_info[4]), 0, 'Withdraw payments balance was not reduced');
            return getBalancePromise(investor);
          })
          .then(_final_bal => assert.equal(+initialBalance - gasToWei(gasUsed) + +ethToWei(amt), +_final_bal,
            'Incorrect amount returned to investor'));
      });
    });
    // end of investor.foreach
  });

  describe('cancelSubscription', () => {

    it('should allocate the investor and investor can subscribe', () => {
      const amt = ethToWei(INVESTOR_ALLOCATION);
      return fund.modifyAllocation(INVESTOR1, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR1))
        .then((_info) => assert.equal(_info[0].toNumber(), amt, 'Incorrect reset to allocation'))
        .then(() => fund.requestSubscription({ from: INVESTOR1, value: amt, gas: GAS_AMT }))
        .then(() => fund.getInvestor(INVESTOR1))
        .then((_info) => assert.equal(_info[1], amt, 'Subscription rejected on valid subscription requests'));
    });

    // INVESTOR ACTION: Cancel Subscription Requests
    it('should allow canceling existing subscription request', () => {
      return fund.cancelSubscription.call({ from: INVESTOR1 })
        .then(success => assert.isTrue(success))
        .then(() => fund.cancelSubscription({ from: INVESTOR1 }))
        .then(() => fund.getInvestor(INVESTOR1))
        .then((_info) => assert.equal(weiToNum(_info[1]), 0, 'Cancel request did not change amount'));
    });
  });


  describe('fund.totalEthPendingSubscription', () => {

    const added = MIN_INITIAL_SUBSCRIPTION + (INVESTOR_ALLOCATION - MIN_INITIAL_SUBSCRIPTION) * Math.random();

    // MANAGER ACTION: Get total subscriptions
    it('should get correct amount of total subscription requests | calculate incremental change', () => {
      let initialAmt;
      return fund.totalEthPendingSubscription()
        .then(_bal => initialAmt = _bal)
        .then(() => fund.modifyAllocation(INVESTOR1, ethToWei(added), { from: MANAGER }))
        .then(() => fund.requestSubscription({ from: INVESTOR1, value: ethToWei(added), gas: GAS_AMT }))
        .then(() => fund.totalEthPendingSubscription())
        .then(_final_bal => assert.equal(+weiToNum(_final_bal), added + initialAmt, 'Outputs incorrect amount of total subscription'));
    });

    // MANAGER ACTION: Get total subscriptions
    it('should get correct amount of total subscription requests', () => {
      return fund.totalEthPendingSubscription()
        .then((_final_bal) => assert.equal(weiToNum(_final_bal), added, 'Outputs incorrect amount of total subscription'));
    });

  });

  describe('Manager: Subscribe Investors', () => {

    // MANAGER ACTION: Process subscriptions
    it('should allow subscribing a single investor', () => {
      let before, exchange1, totalSupply1, totalEthPendingSubscription1, placeholder,
        after, exchange2, totalSupply2, totalEthPendingSubscription2;

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
          return fund.toShares(before[1]);
        })
        .then((_shares) => {
          assert.equal(weiToNum(after[1]), 0, 'subscription failed to process');
          assert.equal(diffInWei(after[2], before[2]), weiToNum(_shares), 'balance does not increase by the amount of tokens');
          assert.equal(diffInWei(totalEthPendingSubscription1, totalEthPendingSubscription2), weiToNum(before[1]), 'totalEthPendingSubscription does not decrease by the amount of ether');
          assert.equal(Math.round(diffInWei(totalSupply2, totalSupply1) * PRECISION), Math.round(weiToNum(_shares) * PRECISION), 'totalSupply does not increase by the amount of tokens');
          assert.equal(Math.round(diffInWei(exchange2, exchange1) * PRECISION), Math.round(weiToNum(before[1]) * PRECISION), 'exchange balance does not increase by amount of ether');
        })
        .catch((err) => console.error(err));
    });

    // MANAGER ACTION: Process multiple subscriptions
    it('should allow subscribing all investors', () => {
      let before, exchange1, totalSupply1, totalEthPendingSubscription1, placeholder,
        after, exchange2, totalSupply2, totalEthPendingSubscription2;

      const params = { from: MANAGER };

      return Promise.all(investors.map(investorObj =>
        fund.modifyAllocation(investorObj.investor, ethToWei(investorObj.amount), params)))
        .then(() => Promise.all(investors.map(investorObj =>
          fund.getInvestor(investorObj.investor, params))))
        .then((gotInvestor) => Promise.all(investors.map(investorObj =>
          fund.requestSubscription({ from: investorObj.investor, value: ethToWei(investorObj.amount), gas: GAS_AMT }))))
        // .then(() => fund.calcNav(params))
        .then(() => fund.fillAllSubscriptionRequests(params))
        .then(() => Promise.all(investors.map(investorObj => fund.getInvestor(investorObj.investor))))
        .then(_values => {
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
      return fund.requestRedemption(ethToWei(amt), { from: MIN_INVESTOR })
        .then(
        () => assert.throw('should not have accepted request lower than min redemption shares'),
        e => assert.isAtLeast(e.message.indexOf('invalid opcode'), 0))
        .catch(console.warn);
    });

    it('should reject redemption requests higher than sharesOwned', () => {
      let amt;
      return fund.getInvestor(MIN_INVESTOR)
        .then(_shares => {
          amt = _shares[2] + ETH_INCREMENT;
          return fund.requestRedemption(ethToWei(amt), { from: MIN_INVESTOR });
        })
        .then(
        () => assert.throw('should not have accepted request higher than amount of shares owned'),
        e => assert.isAtLeast(e.message.indexOf('invalid opcode'), 0))
        .catch(console.warn);
    });

    it('should let investors request to redeem a valid amount of shares', () => {
      let amt;
      return fund.getInvestor(MIN_INVESTOR)
        .then(_shares => {
          amt = _shares[2];
          return fund.requestRedemption(_shares[2], { from: MIN_INVESTOR });
        })
        .then(() => fund.getInvestor(MIN_INVESTOR))
        .then((_info) => assert.equal(+_info[3], +amt, 'Redemption rejected on valid requests'))
        .catch(console.warn);
    });

    // INVESTOR ACTION: Cancel redemption request
    it('should allow canceling existing redemption requests', () => {
      return fund.cancelRedemption.call({ from: MIN_INVESTOR })
        .then(success => {
          assert.isTrue(success);
          return fund.cancelRedemption({ from: MIN_INVESTOR });
        })
        .then(() => {
          return fund.getInvestor(MIN_INVESTOR);
        })
        .then(_info => assert.equal(weiToNum(_info[3]), 0, 'Cancellation rejected on valid requests'))
        .catch(console.warn);
    });

  });


  describe('Manager: handle redemption requests', () => {
    // MANAGER ACTION: Process redemption
    it('should get correct amount of total redemption requests', () => {
      const added = MIN_REDEMPTION_SHARES;
      let redemption1, redemption2;
      return fund.requestRedemption(ethToWei(added), { from: MIN_INVESTOR })
        .then(() => fund.totalSharesPendingRedemption())
        .then(_bal => redemption1 = _bal)
        .then(() => fund.requestRedemption(ethToWei(added), { from: MID_INVESTOR }))
        .then(() => fund.totalSharesPendingRedemption())
        .then(_final_bal => {
          redemption2 = _final_bal;
          assert.equal(+weiToNum(_final_bal), +added + +weiToNum(redemption1),
            'outputs incorrect amount of total redemptions');
          return fund.requestRedemption(ethToWei(added), { from: MAX_INVESTOR });
        })
    });

    it('should redeem a single investor', () => {
      let before, totalSupply1, totalEthPendingWithdrawal1, placeholder, after, totalSupply2, totalEthPendingWithdrawal2;

      return fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(2 * MIN_REDEMPTION_SHARES) })
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
          return fund.toEth(before[3]);
        })
        .then((_amt) => {
          assert.equal(weiToNum(after[3]), 0, 'redemption failed to process');
          assert.equal(Math.round(diffInWei(after[4], before[4])), Math.round(weiToNum(_amt)), 'ethPendingWithdrawal did not increase by the amount of ether');
          assert.equal(Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(_amt)), 'totalEthPendingWithdrawal does not increase by the amount of ether');
          assert.equal(Math.round(diffInWei(totalSupply1, totalSupply2)), Math.round(weiToNum(before[3])), 'totalSupply does not decrease by the amount of tokens');
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
        .then((success) => assert.isTrue(success, 'fillAllRedemptionRequests failed'))
        .then(() => fund.fillAllRedemptionRequests({ from: MANAGER, gas: GAS_AMT }))
        .then(() => Promise.all(investors.map(investorObj => fund.getInvestor(investorObj.investor))))
        .then((gotInvestors) => {
          redeemRequestAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[3].toNumber(), 0);
          assert.equal(redeemRequestAmount, 0, 'there are still outstanding redemption requests');
          const newWithdrawPaymentsAmount = gotInvestors.reduce((sum, gotInvestor) => sum + gotInvestor[4].toNumber(), 0);
          assert.isAbove(newWithdrawPaymentsAmount, withdrawPaymentsAmount, 'withdraw payments amounts did not increase');
        })
    });

  });

  describe('Manager: handle liquidate investor', () => {
    // MANAGER ACTION: Liquidate investor
    it('should liquidate a subscribed investor', () => {
      let before, bal1, totalEthPendingWithdrawal1, investorBal1, placeholder,
        after, bal2, totalEthPendingWithdrawal2, investorBal2;

      const amt = ethToWei(INVESTOR_ALLOCATION);

      return fund.modifyAllocation(INVESTOR2, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(() => getBalancePromise(INVESTOR2))
        .then(() => fund.requestSubscription({ from: INVESTOR2, value: amt, gas: GAS_AMT }))
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
          return fund.toEth(before[2]);
        })
        .then((_amt) => {
          assert.equal(weiToNum(after[2]), 0, 'liquidation failed to process');
          assert.equal(diffInWei(after[4], before[4]), weiToNum(_amt), 'ethPendingWithdrawal does not increase by the amount of ether');
          assert.equal(Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(after[4])), 'totalEthPendingWithdrawal does not increase by the amount of ether');
          assert.equal(Math.round(diffInWei(totalSupply1, totalSupply2)), Math.round(weiToNum(before[2])), 'totalSupply does not decrease by the amount of tokens');
        })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], amt, 'liquidate investor withdrawal amount is incorrect'))
        .then(() => fund.withdrawPayment({ from: INVESTOR2 }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], 0, 'liquidate investor withdraw payment failed'))
    });

    it('should liquidate an investor who has requested subscription', () => {
      let before, bal1, totalEthPendingWithdrawal1, investorBal1, placeholder,
        after, bal2, totalEthPendingWithdrawal2, investorBal2;

      const amt = ethToWei(INVESTOR_ALLOCATION);

      return fund.modifyAllocation(INVESTOR2, amt, { from: MANAGER })
        .then(() => fund.getInvestor(INVESTOR2))
        .then(() => getBalancePromise(INVESTOR2))
        .then(() => fund.requestSubscription({ from: INVESTOR2, value: amt, gas: GAS_AMT }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[1], amt, 'liquidate investor: requestSubscription failed'))
        .then(() => fund.liquidateInvestor(INVESTOR2, { from: MANAGER }))
        .then(txObj => assert.equal(txObj.logs[0].event, 'LogLiquidation', 'LogLiquidation failed'))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => {
          assert.equal(_gotInvestor[1], 0, 'subscription request amount did not change');
          assert.equal(_gotInvestor[4], amt, 'liquidate investor withdrawal amount is incorrect');
        })
        .then(() => fund.withdrawPayment({ from: INVESTOR2 }))
        .then(() => fund.getInvestor(INVESTOR2))
        .then(_gotInvestor => assert.equal(_gotInvestor[4], 0, 'liquidate investor withdraw payment failed'))
    });
  });

  // TO-DO: Since withdrawPaymentForInvestor has been removed, 
  // change to a test where investor approves manager, and manager utilizes transferFrom function
  xit('should allow investors to approve another address for transferFrom', (done) => {
    let before, bal1, totalEthPendingWithdrawal1, managerBal1, placeholder,
      after, bal2, totalEthPendingWithdrawal2, managerBal2;

    Promise.all([
      fund.getInvestor(INVESTOR2), getBal(fund.address), fund.totalEthPendingWithdrawal(), getBal(MANAGER),
      fund.withdrawPaymentForInvestor(INVESTOR1, { from: MANAGER })])
      .then((_values) => {
        [before, bal1, totalEthPendingWithdrawal1, managerBal1, placeholder] = _values;
        return Promise.all([
          fund.getInvestor(INVESTOR1), getBal(fund.address), fund.totalEthPendingWithdrawal(), getBal(MANAGER)]);
      }).then((_results) => {
        [after, bal2, totalEthPendingWithdrawal2, managerBal2] = _results;
        const amt = weiToNum(before[4]);
        assert.equal(weiToNum(after[4]), 0, 'withdrawal failed to process');
        assert.equal(Math.round(bal1 - bal2), Math.round(amt), 'fund balance does not decrease by the amount of ether');
        assert.equal(Math.round(managerBal2 - managerBal1), Math.round(amt), 'manager balance does not increase by the amount of ether');
        done();
      });
  });

  describe('Contract Maintenance', () => {
    // Contract Maintenance
    let addresses;
    it('should fetch a list of investor addresses', () => fund.getInvestorAddresses()
      .then((_addresses) => {
        addresses = _addresses;
        assert.equal(_addresses.length, INVESTOR_COUNT, 'list does not include all investors')
      })
    );

    it('should liquidate & withdraw all investors', () => {
      return getBalancePromise(EXCHANGE)
        .then(_bal => fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(weiToNum(_bal) - 1) }))
        .then(() => Promise.all(addresses.map(address => fund.liquidateInvestor(address, { from: MANAGER }))))
        .then(() => Promise.all(addresses.map(address => fund.getInvestor(address))))
        .then((gotInvestors) => {
          const withdrawAddresses = [];
          gotInvestors.forEach((gotInvestor, index) => {
            if (+gotInvestor[4] > 0) {
              withdrawAddresses.push(addresses[index]);
            }
          })
          return Promise.all(withdrawAddresses.map(address => fund.withdrawPayment({ from: address })));
        })
        .then(() => Promise.all(addresses.map(address => fund.getInvestor(address))))
        .then((gotInvestors) => {
          gotInvestors.forEach(
            gotInvestor => gotInvestor.forEach(
              amount => assert.equal(amount, 0, 'an amount was not zeroed out')
            )
          );
        })
    });

    it('should remove an investor in the middle of the list', () => {
      let investoraddresses, investor;
      return fund.getInvestorAddresses({ from: MANAGER })
        .then((_addresses) => {
          assert.isAbove(_addresses.length, 3, 'there must be more than 3 investors in the investorAddresses list');
          investorAddresses = _addresses.slice(0);
          investor = investorAddresses[1];
        })
        .then(() => fund.removeInvestor.call(investor, { from: investor }))
        .then(success => assert.isFalse(success, 'Only manager should be able to remove an address'))
        .then(() => fund.removeInvestor(investor, { from: MANAGER }))
        .then(() => fund.getInvestorAddresses())
        .then((_addresses) => {
          assert.equal(_addresses.length, investorAddresses.length - 1, 'investor addresses list length should have decreased');
          assert.equal(_addresses.indexOf(investor), -1, 'removed investor should no longer be in investorAddresses');
        });
    });

    it('should remove an investor in the beginning of the list', () => {
      let investoraddresses, investor;
      return fund.getInvestorAddresses({ from: MANAGER })
        .then((_addresses) => {
          assert.isAbove(_addresses.length, 2, 'there must be at leasst 2 investors in the investorAddresses list');
          investorAddresses = _addresses.slice(0);
          investor = investorAddresses[0];
        })
        .then(() => fund.removeInvestor.call(investor, { from: investor }))
        .then(success => assert.isFalse(success, 'Only manager should be able to remove an address'))
        .then(() => fund.removeInvestor(investor, { from: MANAGER }))
        .then(() => fund.getInvestorAddresses())
        .then((_addresses) => {
          assert.equal(_addresses.length, investorAddresses.length - 1, 'investor addresses list length should have decreased');
          assert.equal(_addresses.indexOf(investor), -1, 'removed investor should no longer be in investorAddresses');
        });
    });

    it('should remove an investor at the end of the list', () => {
      let investoraddresses, investor;
      return fund.getInvestorAddresses({ from: MANAGER })
        .then((_addresses) => {
          assert.isAbove(_addresses.length, 2, 'there must be at least 2 investors in the investorAddresses list');
          investorAddresses = _addresses.slice(0);
          investor = investorAddresses[investorAddresses.length - 1];
        })
        .then(() => fund.removeInvestor.call(investor, { from: investor }))
        .then(success => assert.isFalse(success, 'Only manager should be able to remove an address'))
        .then(() => fund.removeInvestor(investor, { from: MANAGER }))
        .then(() => fund.getInvestorAddresses())
        .then((_addresses) => {
          assert.equal(_addresses.length, investorAddresses.length - 1, 'investor addresses list length should have decreased');
          assert.equal(_addresses.indexOf(investor), -1, 'removed investor should no longer be in investorAddresses');
        });
    });

    it('should modify exchange address', (done) => {
      fund.setExchange(accounts[9])
        .then(() => fund.exchange.call())
        .then((_exchange) => assert.equal(_exchange, accounts[9], 'wrong exchange address'))
        .then(() => fund.setExchange(EXCHANGE))
        .then(() => done());
    });

    it('should modify navCalculator address', (done) => {
      fund.setNavCalculator(accounts[9])
        .then(() => fund.navCalculator.call())
        .then((_calculator) => assert.equal(_calculator, accounts[9], 'wrong navCalculator address'))
        .then(() => fund.setNavCalculator(navCalculator.address))
        .then(() => done());
    });

    it('should modify investorActions address', (done) => {
      fund.setInvestorActions(accounts[9])
        .then(() => fund.investorActions.call())
        .then((_investorActions) => assert.equal(_investorActions, accounts[9], 'wrong investorActions address'))
        .then(() => fund.setInvestorActions(investorActions.address))
        .then(() => done());
    });
  });

});
