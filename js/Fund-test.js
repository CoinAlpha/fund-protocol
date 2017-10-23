/* Truffle console commands
---------------------------
Start with `truffle console` from the command line, and run these commands in order.  Make sure that you are running an Ethereum client in another window.
*/

// Helpers
gasAmt = 500000
getBal = address => web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber()
weiToNum = wei => web3.fromWei(wei, 'ether').toNumber()
ethToWei = eth => web3.toWei(eth, 'ether')

owner = web3.eth.accounts[0]
exchange = web3.eth.accounts[1]
investor1 = web3.eth.accounts[2]
investor2 = web3.eth.accounts[3]
manager = web3.eth.accounts[0]

// (IF TESTNET) Unlock accounts
web3.personal.unlockAccount(owner, '<INSERT PASSWORD>', 15000)
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
var dataFeedEvents = dataFeed.allEvents(function(error, event) { if (!error) console.log(event.args); });

// Set fund address for navCalculator
navCalculator.setFund(fund.address)
investorActions.setFund(fund.address)

// Ensure datafeed is updated
dataFeed.updateWithExchange(100)

// Add investors to whitelist
fund.modifyAllocation(investor1, ethToWei(20))
fund.modifyAllocation(investor2, ethToWei(20))

// Investors invest
fund.requestSubscription(30000, {from:investor1, value: ethToWei(20), gas:gasAmt})
fund.requestSubscription(30000, {from:investor2, value: ethToWei(20), gas:gasAmt})

// Update datafeed value, and re-calculate NAV
dataFeed.updateWithExchange(100);
fund.calcNav();

// Process subscription requests
fund.fillAllSubscriptionRequests();

// Investor requests redemption
fund.requestRedemption(600000,{from:investor2})

// Fulfill all sharesPendingRedemption requests
fund.totalEthPendingRedemption().then(amount => fund.remitFromExchange({from:exchange, value:amount, gas:gasAmt}));

// Update datafeed value, and re-calculate NAV
dataFeed.updateWithExchange(100);
fund.calcNav();

// Process redemption requests
fund.fillAllRedemptionRequests();

// Investor withdraws ethPendingWithdrawal
fund.withdrawPayment({from:investor2})

// Liquidate investor (make sure before calling that fund balance is more than nav * tokens)
fund.liquidateInvestor(investor1);

// Liquidate investor (make sure before calling that fund balance is more than nav * totalSupply)
fund.liquidateAll();

// Close fund
fund.destroy()