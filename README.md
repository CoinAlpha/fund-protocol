# CoinAlpha Fund Protocol

A blockchain protocol for tokenized hedge funds.

This open-source protocol enables asset managers to create a blockchain-based vehicle that manages capital contributed by external investors. The protocol utilizes the blockchain to perform functions such as segregated asset custody, net asset value calculation, fee accounting, and management of investor in-flows and out-flows.  The goal of this project is to eliminate the setup and operational costs imposed by middlemen in traditional funds, while maximizing transparency and liquidity for investors.  

For more information about the project, please see the our [wiki](https://github.com/CoinAlpha/fund-protocol/wiki).

## Installation

### Geth
Ethereum client for testnet and live
```
brew tap ethereum/ethereum
brew install ethereum
```

### TestRPC
Ethereum client for local testing
```
npm install -g ethereumjs-testrpc
```

### Truffle
Deployment and testing framework.  Use v4.0.0-beta.0 which ships with solc v0.4.15.
```
npm install -g truffle@4.0.0-beta.0
```


### Libraries and dependencies
```
npm install
```
## Testing

### Local
1. Run TestRPC with a 1 second block time and increased block gas limit, to allow for simulation of time-based fees: `testrpc -b 1 -l 7000000` 
2. In another Terminal window, `truffle console`
3. `truffle test` to run all tests

### Testnet
1. Run `geth --testnet --rpc --rpcapi eth,net,web3,personal`
2. In another Terminal window, `truffle console`
3. `web3.eth.accounts` and check that you have at least 4 accounts.  Each account should have more than 5 test eth.
4. Unlock your primary account: `web3.personal.unlockAccount(web3.eth.accounts[0], <INSERT YOUR PASSWORD HERE>, 15000)`
5. Follow manual testing workflows in `js/Fund-test.js`

### Ethereum Bridge | Oraclize
Ethereum Bridge is used for connecting to Oraclize from a non-public blockchain instance (e.g. testrpc).  This is used for testing the DataFeed contracts.

1. In a separate folder from this repo, clone the repo: `git clone https://github.com/oraclize/ethereum-bridge`
2. Setup: `cd ethereum-bridge; npm install`
3. When running testrpc, use the same mnemonic to keep the OraclizeAddrResolver address constant: `testrpc -l 7000000 -p 7545 -a 50 --mnemonic "coinalpha"`
4. Run: `node bridge -a 49 -H localhost:7545 --dev` (`-a 49` uses the 49th testrpc account for deploying oraclize; the 9th account should not be used for any other purposes, and port 7545)
5. After starting the bridge, take note of this message:

  ```
  Please add this line to your contract constructor:

  OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
  ```

6. Add this line into DataFeel.sol