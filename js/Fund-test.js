/* Truffle console commands
---------------------------
Start with `truffle console` from the command line, and run these commands in order.  Make sure that you are running an Ethereum client in another window.
*/

// Helpers
gasAmt = 500000
getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber()
weiToNum = wei => web3.fromWei(wei, 'ether').toNumber()
ethToWei = eth => web3.toWei(eth, 'ether')

manager = web3.eth.accounts[0]
exchange = web3.eth.accounts[1]
investor1 = web3.eth.accounts[2]
investor2 = web3.eth.accounts[3]

// (IF TESTNET) Unlock accounts
web3.personal.unlockAccount(manager, '<INSERT PASSWORD>', 15000)
web3.personal.unlockAccount(exchange, '<INSERT PASSWORD>', 15000)
web3.personal.unlockAccount(investor1, '<INSERT PASSWORD>', 15000)
web3.personal.unlockAccount(investor2, '<INSERT PASSWORD>', 15000)

// Deploy contracts
truffle migrate --reset                   // TESTRPC ONLY
truffle migrate --network ropsten --reset // TESTNET ONLY

// Get instances
Fund.deployed().then( instance => fund = instance )
NavCalculator.deployed().then( instance => navCalculator = instance )
InvestorActions.deployed().then( instance => investorActions = instance )
DataFeed.deployed().then(instance => dataFeed = instance)

// Log all events
var fundEvents = fund.allEvents(function(error, event) { if (!error) console.log(event.args); });
var calcEvents = navCalculator.allEvents(function(error, event) { if (!error) console.log(event.args); });
var valueFeedEvents = valueFeed.allEvents(function(error, event) { if (!error) console.log(event.args); });

// Set fund address for navCalculator
navCalculator.setFund(fund.address)
investorActions.setFund(fund.address)

// Ensure datafeed is updated
dataFeed.updateWithExchange(100)

// Add investors to whitelist
fund.modifyAllocation(investor1, ethToWei(20))
fund.modifyAllocation(investor2, ethToWei(20))

// Change exchange account balance to simulate trading P&L
web3.eth.sendTransaction({from:exchange, to: manager, value: ethToWei(1), gas:gasAmt})
web3.eth.sendTransaction({from:manager, to:exchange, value: ethToWei(1), gas:gasAmt})

// Investors invest (fallback and subscribe function)
web3.eth.sendTransaction({from:investor1, to:fund.address, value: ethToWei(20), gas:gasAmt})
fund.requestSubscription({from:investor2, value: ethToWei(20), gas:gasAmt})

// Calc NAV, then process all subscription requests
fund.calcNav().then(() => fund.fillAllSubscriptionRequests());

// ======== ERC20 tests ==========
// investor2 transfers one token to investor1
fund.transfer(investor1, ethToWei(1), {from:investor2});

// investor1 tries to transfer two tokens back to investor2 (fails since it exceeds the ethTotalAllocation)
fund.transfer(investor2, ethToWei(2), {from:investor1});

// investor1 approves investor2 to spend one token
fund.approve(investor2, ethToWei(1), {from:investor1});

// investor2 pulls one token from investor1
fund.transferFrom(investor1, investor2, ethToWei(1), {from:investor2});

// Remit fees from exchange to contract
fund.getTotalFees().then(amount => fund.remitFromExchange({from:exchange, value:amount, gas:gasAmt}))
fund.withdrawFees()

// Investor requests redemption
fund.requestRedemption(ethToWei(1),{from:investor2})

// Fulfill all sharesPendingRedemption requests
fund.totalEthPendingRedemption().then(amount => fund.remitFromExchange({from:exchange, value:amount, gas:gasAmt}));
fund.fillAllRedemptionRequests();

// Investor withdraws ethPendingWithdrawal
fund.withdrawPayment({from:investor2})

// Liquidate investor (make sure before calling that fund balance is more than nav * tokens)
fund.liquidateInvestor(investor1);

// Liquidate investor (make sure before calling that fund balance is more than nav * totalSupply)
fund.liquidateAll();

// Close fund
fund.destroy()