pragma solidity 0.4.13;

import './oraclize/oraclizeAPI.sol';
import './zeppelin/DestructibleModified.sol';
import "./math/SafeMath.sol";

/**
 * @title DataFeed
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev Generic Oraclize data feed contract for data feeds returning an unsigned integer.
 */

contract DataFeed is usingOraclize, DestructibleModified {
  using SafeMath for uint;

  // Global variables 
  string  public name;                   // To differentiate in case there are multiple feeds
  bool    public useOraclize;            // True: use Oraclize (on testnet).  False: use testRPC address.
  uint    public value;                  // API value
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
  event LogDataFeedResponse(string name, uint value, uint timestamp);


  function DataFeed(
    string  _name,
    bool    _useOraclize,
    string  _queryUrl,
    uint    _secondsBetweenQueries,
    address _exchange
  ) 
    payable
  {
    // Constants
    name = _name;
    useOraclize = _useOraclize;
    queryUrl = _queryUrl;
    secondsBetweenQueries = _secondsBetweenQueries;
    exchange = _exchange;
    gasLimit = 200000;                                // Oraclize default value

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

  function __callback(bytes32 _myid, string _result) {
    require(validIds[_myid]);
    require(msg.sender == oraclize_cbAddress());
    value = parseInt(_result, 4);
    timestamp = now;
    LogDataFeedResponse(name, value, timestamp);
    delete validIds[_myid];
    updateWithOraclize();
  }
  
  
  function updateWithExchange(uint _percent) 
    onlyOwner
    returns (bool success)
  {
    if (!useOraclize) {
      value = exchange.balance.mul(_percent).div(100);
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