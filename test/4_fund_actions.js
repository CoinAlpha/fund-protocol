const Fund = artifacts.require('./Fund.sol');
const NavCalculator = artifacts.require('./NavCalculator.sol');
const InvestorActions = artifacts.require('./InvestorActions.sol');

contract('Fund Actions', (accounts) => {
  const MANAGER = accounts[0];
  const EXCHANGE = accounts[1];
  const INVESTOR1 = accounts[2];
  const INVESTOR2 = accounts[3];
  const GAS_AMT = 500000;

  // helpers
  const getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber();
  const weiToNum = wei => web3.fromWei(wei, 'ether').toNumber();
  const ethToWei = eth => web3.toWei(eth, 'ether');
  const diffInWei = (a, b) => weiToNum(a) - weiToNum(b);

  let fund, navCalculator, investorActions;

  before(() => {
    Promise.all([Fund.deployed(), NavCalculator.deployed(), InvestorActions.deployed()])
    .then(values => {
      [fund, navCalculator, investorActions] = values;
      navCalculator.setFund(fund.address);
      investorActions.setFund(fund.address);
    })
  });

  it('should get investor information from investor address', (done) => {
    fund.getInvestor(INVESTOR1).then(_info => {
      assert.equal(weiToNum(_info[0]), 0, 'Incorrect ethTotalAllocation amount');
      assert.equal(weiToNum(_info[1]), 0, 'Incorrect ethPendingSubscription amount');
      assert.equal(weiToNum(_info[2]), 0, 'Incorrect balance amount');
      assert.equal(weiToNum(_info[3]), 0, 'Incorrect sharesPendingRedemption amount');
      assert.equal(weiToNum(_info[4]), 0, 'Incorrect ethPendingWithdrawal amount');
      done();
    });
  });

  // MANAGER ACTION: Modify allocation
  it('should add input amount to ethTotalAllocation', (done) => {
    const amt = ethToWei(4);
    fund.modifyAllocation(INVESTOR1, amt).then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(_info[0], amt, 'Incorrect reset to allocation');
      done();
    });
  });

  // INVESTOR ACTION: Subscription Requests
  it('should reject subscription requests lower than minInitialSubscriptionEth', (done) => {
    const amt = 2;
    fund.requestSubscription({ from: INVESTOR1, value: ethToWei(amt), gas: GAS_AMT })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[1]), 0, 'Subscription accepted when amount is lower than minimum');
      done();
    });
  });

  it('should reject subscription requests higher than allocation', (done) => {
    const amt = 5;
    fund.requestSubscription({ from: INVESTOR1, value: ethToWei(amt), gas: GAS_AMT })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[1]), 0, 'Subscription accepted when amount is higher than allocation');
      done();
    });
  });

  it('should make subscription request given valid amount', (done) => {
    const amt = 4;
    fund.requestSubscription({ from: INVESTOR1, value: ethToWei(amt), gas: GAS_AMT })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[1]), amt, 'Subscription rejected on valid subscription requests');
      done();
    });
  });

  // INVESTOR ACTION: Cancel Subscription Requests
  it('should allow canceling existing subscription request', (done) => {
    fund.cancelSubscription({ from: INVESTOR1 })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[1]), 0, 'Subscription rejected on valid subscription requests');
      done();
    });
  });

  // MANAGER ACTION: Get total subscriptions
  it('should get correct amount of total subscription requests', (done) => {
    const added = 4;
    let initialAmt;
    fund.requestSubscription({ from: INVESTOR1, value: ethToWei(added), gas: GAS_AMT })
    .then(() => fund.totalEthPendingSubscription())
    .then((_bal) => { initialAmt = weiToNum(_bal); })
    .then(() => { fund.modifyAllocation(INVESTOR2, ethToWei(added)); })
    .then(() => {
      return fund.requestSubscription({ from: INVESTOR2, value: ethToWei(added), gas: GAS_AMT });
    })
    .then(() => {
      return fund.totalEthPendingSubscription();
    }).then((_final_bal) => {
      assert.equal(weiToNum(_final_bal), added + initialAmt, 'Outputs incorrect amount of total subscription');
      done();
    });
  });

  // MANAGER ACTION: Process subscriptions
  it('should allow subscribing a single investor', (done) => {
    let before, exchange1, totalSupply1, totalEthPendingSubscription1, placeholder,
        after, exchange2, totalSupply2, totalEthPendingSubscription2;

    Promise.all([
      fund.getInvestor(INVESTOR1), getBal(EXCHANGE), fund.totalSupply(), fund.totalEthPendingSubscription(),
      fund.subscribeInvestor(INVESTOR1)])
    .then((_values) => {
      [before, exchange1, totalSupply1, totalEthPendingSubscription1, placeholder] = _values;
      return Promise.all([
        fund.getInvestor(INVESTOR1), getBal(EXCHANGE), fund.totalSupply(), fund.totalEthPendingSubscription() ]);
    }).then((_results) => {
      [after, exchange2, totalSupply2, totalEthPendingSubscription2] = _results;
      return fund.toShares(before[1]);
    }).then((_shares) => {
      assert.equal(weiToNum(after[1]), 0, 'subscription failed to process');
      assert.equal(diffInWei(after[2], before[2]), weiToNum(_shares), 'balance does not increase by the amount of tokens');
      assert.equal(diffInWei(totalEthPendingSubscription1, totalEthPendingSubscription2), weiToNum(before[1]), 'totalEthPendingSubscription does not decrease by the amount of ether');
      assert.equal(Math.round(diffInWei(totalSupply2, totalSupply1)), Math.round(weiToNum(_shares)), 'totalSupply does not increase by the amount of tokens');
      assert.equal(exchange2 - exchange1, weiToNum(before[1]), 'exchange balance does not increase by amount of ether');
      done();
    })
    .catch(console.error);
  });

  it('should allow processing of all subscription requests', (done) => {
    const promises = [];
    fund.calcNav()
    .then(() => fund.fillAllSubscriptionRequests())
    .then(() => fund.getInvestorAddresses())
    .then((_addresses) => {
      for (let i = 0; i < _addresses.length; i++) {
        promises.push(fund.getInvestor(_addresses[i]));
      }
      return Promise.all(promises);
    }).then((_values) => {
      _values.forEach((val) => {
        assert.equal(weiToNum(val[1]), 0, 'Subscription failed to process');
      });
      done();
    });
  });

  // INVESTOR ACTION: Request redemption
  it('should reject redemption requests lower than minRedemptionShares', (done) => {
    const amt = 0.5;
    fund.requestRedemption(ethToWei(amt),{ from: INVESTOR1 })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[3]), 0, 'Redemption processed on requests lower than minimum');
      done();
    });
  });

  it('should reject redemption requests higher than sharesOwned', (done) => {
    const amt = 5;
    fund.requestRedemption(ethToWei(amt),{ from: INVESTOR1 })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[3]), 0, 'Redemption processed on requests higher than minimum');
      done();
    });
  });

  it('should let investors request to redeem a valid amount of shares', (done) => {
    const amt = 1;
    fund.requestRedemption(ethToWei(amt), { from: INVESTOR1 })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[3]), amt, 'Redemption rejected on valid requests');
      done();
    });
  });

  // INVESTOR ACTION: Cancel redemption request
  it('should allow canceling existing redemption requests', (done) => {
    fund.cancelRedemption({ from: INVESTOR1 })
    .then(() => {
      return fund.getInvestor(INVESTOR1);
    }).then((_info) => {
      assert.equal(weiToNum(_info[3]), 0, 'Cancellation rejected on valid requests');
      done();
    });
  });

  // MANAGER ACTION: Process redemption
  it('should get correct amount of total redemption requests', (done) => {
    const added = 1;
    let initialAmt;
    fund.requestRedemption(ethToWei(1), { from: INVESTOR1 })
    .then(() => fund.totalSharesPendingRedemption())
    .then((_bal) => { initialAmt = _bal; })
    .then(() => fund.requestRedemption(ethToWei(added), { from: INVESTOR2 }))
    .then(() => fund.totalSharesPendingRedemption())
    .then((_final_bal) => {
      assert(weiToNum(_final_bal) === added + weiToNum(initialAmt), 'outputs incorrect amount of total redemptions');
      done();
    });
  });

  it('should redeem a single investor', (done) => {
    let before, totalSupply1, totalEthPendingWithdrawal1, placeholder, after, totalSupply2, totalEthPendingWithdrawal2;

    fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(2) })
    .then(() => {
      return Promise.all([
      fund.getInvestor(INVESTOR1), fund.totalSupply(), fund.totalEthPendingWithdrawal(),
      fund.redeemInvestor(INVESTOR1)]);
    }).then((_values) => {
      [before, totalSupply1, totalEthPendingWithdrawal1, placeholder] = _values;
      return Promise.all([
        fund.getInvestor(INVESTOR1), fund.totalSupply(), fund.totalEthPendingWithdrawal() ]);
    }).then((_results) => {
      [after, totalSupply2, totalEthPendingWithdrawal2] = _results;
      return fund.toEth(before[3]);
    }).then((_amt) => {
      assert.equal(weiToNum(after[3]), 0, 'redemption failed to process');
      assert.equal(Math.round(diffInWei(after[4], before[4])), Math.round(weiToNum(_amt)), 'ethPendingWithdrawal does not increase by the amount of ether');
      assert.equal(Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(_amt)), 'totalEthPendingWithdrawal does not increase by the amount of ether');
      assert.equal(Math.round(diffInWei(totalSupply1, totalSupply2)), Math.round(weiToNum(before[3])), 'totalSupply does not decrease by the amount of tokens');
      done();
    }).catch(console.log);
  });

  it('should redeem all redemption requests', (done) => {
    const promises = [];
    fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(5), gas: GAS_AMT })
    .then(() => fund.fillAllRedemptionRequests())
    .then(() => fund.getInvestorAddresses())
    .then((_addresses) => {
      for (let i = 0; i < _addresses.length; i++) {
        promises.push(fund.getInvestor(_addresses[i]));
      }
      return Promise.all(promises);
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[3]), 0, `redemption index: ${index}, addr: ${val} failed to process`);
      });
      done();
    });
  });


  // INVESTOR ACTION: Withdraw payments
  it('should allow investors to withdraw payments', (done) => {
    let before, bal1, totalEthPendingWithdrawal1, investorBal1, placeholder,
        after, bal2, totalEthPendingWithdrawal2, investorBal2;

    Promise.all([
      fund.getInvestor(INVESTOR1), getBal(fund.address), fund.totalEthPendingWithdrawal(), getBal(INVESTOR1),
      fund.withdrawPayment({ from: INVESTOR1 })])
    .then((_values) => {
      [before, bal1, totalEthPendingWithdrawal1, investorBal1, placeholder] = _values;
      return Promise.all([
        fund.getInvestor(INVESTOR1), getBal(fund.address), fund.totalEthPendingWithdrawal(), getBal(INVESTOR1)]);
    }).then((_results) => {
      [after, bal2, totalEthPendingWithdrawal2, investorBal2] = _results;
      const amt = weiToNum(before[4]);
      assert.equal(weiToNum(after[4]), 0, 'withdrawal failed to process');
      assert.equal(Math.round(bal1 - bal2), Math.round(amt), 'fund balance does not decrease by the amount of ether');
      assert.equal(Math.round(investorBal2 - investorBal1), Math.round(amt), 'investor balance does not increase by the amount of ether');
      done();
    });
  });

  // TO-DO: Since withdrawPaymentForInvestor has been removed, 
  // change to a test where investor approves manager, and manager utilizes transferFrom function
  xit('should allow investors to approve another address for transferFrom', (done) => {
    let before, bal1, totalEthPendingWithdrawal1, managerBal1, placeholder,
        after, bal2, totalEthPendingWithdrawal2, managerBal2;

    Promise.all([
      fund.getInvestor(INVESTOR1), getBal(fund.address), fund.totalEthPendingWithdrawal(), getBal(MANAGER),
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

  // MANAGER ACTION: Liquidate investor
  it('should liquidate a single investor', (done) => {
    let before, bal1, totalEthPendingWithdrawal1, investorBal1, placeholder,
        after, bal2, totalEthPendingWithdrawal2, investorBal2;

    fund.requestSubscription({ from: INVESTOR1, value: ethToWei(2), gas: GAS_AMT })
    .then(() => fund.subscribeInvestor(INVESTOR1))
    .then(() => { fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(2), gas: GAS_AMT })
    }).then(() => {
      return Promise.all([
      fund.getInvestor(INVESTOR1), fund.totalSupply(), fund.totalEthPendingWithdrawal(),
      fund.liquidateInvestor(INVESTOR1)]);
    }).then((_values) => {
      [before, totalSupply1, totalEthPendingWithdrawal1, placeholder] = _values;
      return Promise.all([
        fund.getInvestor(INVESTOR1), fund.totalSupply(), fund.totalEthPendingWithdrawal() ]);
    }).then((_results) => {
      [after, totalSupply2, totalEthPendingWithdrawal2] = _results;
      return fund.toEth(before[2]);
    }).then((_amt) => {
      assert.equal(weiToNum(after[2]), 0, 'liquidation failed to process');
      assert.equal(diffInWei(after[4], before[4]), weiToNum(_amt), 'ethPendingWithdrawal does not increase by the amount of ether');
      assert.equal(Math.round(diffInWei(totalEthPendingWithdrawal2, totalEthPendingWithdrawal1)), Math.round(weiToNum(after[4])), 'totalEthPendingWithdrawal does not increase by the amount of ether');
      assert.equal(Math.round(diffInWei(totalSupply1, totalSupply2)), Math.round(weiToNum(before[2])), 'totalSupply does not decrease by the amount of tokens');
      done();
    });

  });

  it('should liquidate all ethPendingSubscriptions', (done) => {
    const promises = [];
    fund.requestSubscription({ from: INVESTOR2, value: ethToWei(2), gas: GAS_AMT })
    .then(() => fund.subscribeInvestor(INVESTOR2))
    .then(() => { fund.remitFromExchange({ from: EXCHANGE, value: ethToWei(2), gas: GAS_AMT })
    }).then(() => fund.liquidateAllInvestors())
    .then(() => fund.getInvestorAddresses())
    .then((_addresses) => {
      for (let i = 0; i < _addresses.length; i++) {
        promises.push(fund.getInvestor(_addresses[i]));
      }
      return Promise.all(promises);
    }).then((_values) => {
      _values.forEach((val, index) => {
        assert.equal(weiToNum(val[2]), 0, `liquidation index: ${index}, addr: ${val} failed to process`);
      });
      done();
    });
  });

  // Contract Maintenance
  it('should fetch a list of investor addresses', (done) => {
    fund.getInvestorAddresses()
    .then((_addresses) => {
      assert.equal(_addresses.length, 2, 'list does not include all investors');
      done();
    });
  });

  it('should modify exchange address', (done) => {
    fund.setExchange(accounts[9])
    .then(() => fund.exchange.call())
    .then((_exchange) => {
      assert.equal(_exchange, accounts[9], 'wrong exchange address');
    }).then(() => fund.setExchange(EXCHANGE))
    .then(() => done());
  });

  it('should modify navCalculator address', (done) => {
    fund.setNavCalculator(accounts[9])
    .then(() => fund.navCalculator.call())
    .then((_calculator) => {
      assert.equal(_calculator, accounts[9], 'wrong navCalculator address');
    }).then(() => fund.setNavCalculator(navCalculator.address))
    .then(() => done());
  });

  it('should modify investorActions address', (done) => {
    fund.setInvestorActions(accounts[9])
    .then(() => fund.investorActions.call())
    .then((_investorActions) => {
      assert.equal(_investorActions, accounts[9], 'wrong investorActions address');
    }).then(() => fund.setInvestorActions(investorActions.address))
    .then(() => done());
  });

});
