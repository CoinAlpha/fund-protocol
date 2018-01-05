module.exports = {
    "extends": "airbnb",
    "rules": {
        "comma-dangle" : ["error"],
        "no-console": "off",
        "no-multi-spaces": ["error", { ignoreEOLComments: true }],
        "no-return-assign": "off",
        "no-unused-vars": ["off", { "vars": "all", "args": "after-used", "ignoreRestSiblings": false }],
        "max-len": ["error", {"code": 150}],
        "prefer-destructuring": ["off", {
            "array": true,
            "object": true
        }]
    },
    "globals": {
        "artifacts" : true,
        "assert" : true,
        "before" : true,
        "beforeEach" : true,
        "contract": true,
        "describe": true,
        "xdescribe": true,
        "dataFeed": true,
        "getBal": true,
        "it" : true,
        "radix": true,
        "web3" : true,
        "xit" : true,
      }
};