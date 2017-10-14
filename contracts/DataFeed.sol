pragma solidity ^0.4.13;

import './oraclize/oraclizeAPI.sol';
import './zeppelin/DestructibleModified.sol';
import "./math/SafeMath.sol";
import "./jsmnsol/JsmnSolLib.sol";

/**
 * @title DataFeed
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev Generic Oraclize data feed contract for data feeds returning an unsigned integer.
 */

contract DataFeed is usingOraclize, DestructibleModified {
  using SafeMath for uint;
  using JsmnSolLib for string;

  // Global variables
  bool    public useOraclize;            // True: use Oraclize.  False: use testRPC address.
  uint    public value;                  // Total portfolio value in USD
  uint    public usdEth;                 // USD/ETH exchange rate
  uint    public timestamp;              // Timestamp of last update

  // Oraclize-specific variables
  string  public queryUrl;               // URL of the API to query, usually "json(<URL>).XX"
  uint    public secondsBetweenQueries;  // Interval between queries
  mapping(bytes32 => bool) validIds;     // Array of queryIds that prevents duplicate queries
  uint    public gasLimit;
  uint    public gasPrice;

  // TestRPC-specific variables
  address public  exchange;              // Address of the exchange account used to calculate the value locally

  // Only emitted when useOraclize is true
  event LogDataFeedQuery(string description);
  event LogDataFeedResponse(string rawResult, uint value, uint usdEth, uint timestamp);
  event LogDataFeedError(string rawResult);

  function DataFeed(
    bool    _useOraclize,
    string  _queryUrl,
    uint    _secondsBetweenQueries,
    uint    _initialExchangeRate,
    address _exchange
  )
    payable
  {
    // Constants
    useOraclize = _useOraclize;
    queryUrl = _queryUrl;
    secondsBetweenQueries = _secondsBetweenQueries;
    exchange = _exchange;
    usdEth = _initialExchangeRate;
    gasLimit = 300000;                                // Adjust this value depending on code length

    if (useOraclize) {
      oraclize_setCustomGasPrice(20000000000 wei);    // 20 GWei, Oraclize default
      oraclize_setProof(proofType_NONE);
      updateWithOraclize();
    } else {
      updateWithExchange(100);
    }
  }

  // Updates the value variable by fetching the queryUrl via Oraclize.
  // Recursively calls the update function again after secondsBetweenQueries seconds
  function updateWithOraclize()
    payable
  {
    if (useOraclize) {
      if (oraclize.getPrice("URL") > this.balance) {
        LogDataFeedQuery("Oraclize query was NOT sent, please add some ETH to cover for the query fee");
      } else {
        LogDataFeedQuery("Oraclize query was sent, standing by for the answer..");
        bytes32 queryId = oraclize_query(secondsBetweenQueries, "URL", queryUrl, gasLimit);
        validIds[queryId] = true;
      }
    }
  }

  // Assumes that the result is a raw JSON object with at least 2 fields: 
  // 1) portfolio value in ETH, with 2 decimal places
  // 2) current USD/ETH exchange rate, with 2 decimal places
  // The function parses the JSON and stores the value and usdEth.
  function __callback(bytes32 _myid, string _result) {
    require(validIds[_myid]);
    require(msg.sender == oraclize_cbAddress());
    
    uint returnValue;
    JsmnSolLib.Token[] memory tokens;
    uint actualNum;
    (returnValue, tokens, actualNum) = JsmnSolLib.parse(_result, 10);

    // Check for the success return code and that the object is not an error string
    if (returnValue == 0 && actualNum > 4) {
      string memory valueRaw = JsmnSolLib.getBytes(_result, tokens[2].start, tokens[2].end);
      value = parseInt(valueRaw);

      string memory usdEthRaw = JsmnSolLib.getBytes(_result, tokens[4].start, tokens[4].end);
      usdEth = parseInt(usdEthRaw, 2);

      timestamp = now;

      LogDataFeedResponse(_result, value, usdEth, timestamp);
      updateWithOraclize();
    } else {
      LogDataFeedError(_result);
    }
    delete validIds[_myid];
  }

  function updateWithExchange(uint _percent)
    onlyOwner
    returns (bool success)
  {
    if (!useOraclize) {
      value = exchange.balance.mul(usdEth).mul(_percent).div(1e22);
      timestamp = now;
      return true;
    }
  }

  // ********* ADMIN *********

  function changeQueryUrl(string _url)
    onlyOwner
    returns (bool success)
  {
    queryUrl = _url;
    return true;
  }

  function changeInterval(uint _seconds)
    onlyOwner
    returns (bool success)
  {
    secondsBetweenQueries = _seconds;
    return true;
  }

  function changeGasPrice(uint _price)
    onlyOwner
    returns (bool success)
  {
    gasPrice = _price;
    oraclize_setCustomGasPrice(_price);
    return true;

  }

  function changeGasLimit(uint _limit)
    onlyOwner
    returns (bool success)
  {
    gasLimit = _limit;
    return true;
  }

  function toggleUseOraclize()
    onlyOwner
    returns (bool)
  {
    useOraclize = !useOraclize;
    return useOraclize;
  }

}
