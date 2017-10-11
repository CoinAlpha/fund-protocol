module.exports = {
    "extends": "airbnb",
    "rules": {
        "no-console": "off",
        "no-multi-spaces": ["error", { ignoreEOLComments: true }],
        "max-len": [2, {"code": 150}],
    },
    "globals": {
        "artifacts" : true,
        "assert" : true,
        "before" : true,
        "beforeEach" : true,
        "contract": true,
        "describe": true,
        "dataFeed": true,
        "it" : true,
        "web3" : true,
        "xit" : true,
      }
};