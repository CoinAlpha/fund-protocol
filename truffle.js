module.exports = {
  networks: {
    development: {
      host: "localhost",
      port: 8545,
      network_id: "*", // Match any network id
    },
    ropsten: {
      host: "localhost",
      port: 8545,
      network_id: "3",
      gasPrice: 200000000000,
    }
  }
};
