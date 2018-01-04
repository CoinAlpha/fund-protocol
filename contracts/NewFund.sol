pragma solidity ^0.4.13;

import "./NavCalculator.sol";
import "./NewInvestorActions.sol";
import "./DataFeed.sol";
import "./FundStorage.sol";
import "./math/SafeMath.sol";
import "./zeppelin/DestructiblePausable.sol";


// ==================================== NewFund Interface ======================================

contract INewFund {
  uint    public totalEthPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in ether
  uint    public totalUsdPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in USD (tracking purposes only)
}


// ===================================== NewFund Contract ======================================

contract NewFund is DestructiblePausable {
  using SafeMath for uint;

  // ** CONSTANTS ** set at contract inception
  uint    public decimals;                     // number of decimals used to display navPerShare
  address public manager;                      // address of the manager account allowed to withdraw base and performance management fees
  address public exchange;                     // address of the exchange account where the manager conducts trading.

  // ** FUND BALANCES **
  uint    public totalEthPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in ether
  uint    public totalUsdPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in USD (tracking purposes only)
  uint    public totalSharesPendingRedemption;   // total redemption requests not yet processed by the manager, denominated in shares
  uint    public totalEthPendingWithdrawal;      // total payments not yet withdrawn by investors, denominated in shares
  uint    public totalSupply;                    // total number of shares outstanding

  // ========================================= MODULES ==========================================
  // Where possible, fund logic is delegated to the module contracts below, so that they can be patched and upgraded after contract deployment
  INavCalculator   public navCalculator;         // calculating net asset value
  INewInvestorActions public investorActions;       // performing investor actions such as subscriptions, redemptions, and withdrawals
  IDataFeed        public dataFeed;              // fetching external data like total portfolio value and exchange rates
  IFundStorage     public fundStorage;           // data storage module


  // ========================================= MODIFIERS =========================================
  modifier onlyFromExchange {
    require(msg.sender == exchange);
    _;
  }

  modifier onlyManager {
    require(msg.sender == manager);
    _;
  }

  // ========================================== EVENTS ===========================================

  event LogWhiteListInvestor(address indexed investor, uint investorType, uint shareClass);
  event LogEthSubscriptionRequest(address indexed investor, uint eth);

  event LogModuleChanged(string module, address oldAddress, address newAddress);

  // ======================================== CONSTRUCTOR ========================================
  function NewFund(
    address _manager,
    address _exchange,
    address _navCalculator,
    address _investorActions,
    address _dataFeed,
    address _fundStorage
  )
  {

    // Set the addresses of other wallets/contracts with which this contract interacts
    manager = _manager;
    exchange = _exchange;
    navCalculator = INavCalculator(_navCalculator);
    investorActions = INewInvestorActions(_investorActions);
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
  }  // End of constructor

  // ====================================== SUBSCRIPTIONS ======================================

  // Whitelist an investor
  // Delegates logic to the FundStorage module
  function whiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    onlyManager
    returns (bool isSuccess)
  {
    fundStorage.whiteListInvestor(_investor, _investorType, _shareClass);
    LogWhiteListInvestor(_investor, _investorType, _shareClass);
    return true;
  }

  // [INVESTOR METHOD] Issue a subscription request by transferring ether into the fund
  // Delegates logic to the InvestorActions module
  // usdEthBasis is expressed in USD cents.  For example, for a rate of 300.01, _usdEthBasis = 30001
  function requestEthSubscription()
    whenNotPaused
    payable
    returns (bool success)
  {
    var (_ethPendingSubscription, _totalEthPendingSubscription) = investorActions.requestEthSubscription(msg.sender, msg.value);
    fundStorage.updateEthPendingSubscription(msg.sender, _ethPendingSubscription);
    totalEthPendingSubscription = _totalEthPendingSubscription;

    LogEthSubscriptionRequest(msg.sender, msg.value);
    return true;
  }

  // ========================================== ADMIN ==========================================

  function getFundDetails()
    constant
    public
    returns (
      bytes32 name,
      bytes32 symbol,
      uint minInitialSubscriptionUsd,
      uint minSubscriptionUsd,
      uint minRedemptionShares
    )
  {
    require(address(fundStorage) != address(0));
    return (fundStorage.name(), fundStorage.symbol(), fundStorage.minInitialSubscriptionUsd(), fundStorage.minSubscriptionUsd(), fundStorage.minRedemptionShares());
  }

  // Update the address of a module, for upgrading
  function changeModule(string _module, address _newAddress) 
    onlyOwner
    returns (bool success) 
  {
    require(_newAddress != address(0));
    address oldAddress;
    bytes32 module = keccak256(_module);
    if (module == keccak256("NavCalculator")) {
      oldAddress = navCalculator;
      require(oldAddress != _newAddress);
      navCalculator = INavCalculator(_newAddress);
    } else if (module == keccak256("InvestorActions")) {
      oldAddress = investorActions;
      require(oldAddress != _newAddress);
      investorActions = INewInvestorActions(_newAddress);
    } else if (module == keccak256("DataFeed")) {
      oldAddress = dataFeed;
      require(oldAddress != _newAddress);
      dataFeed = IDataFeed(_newAddress);
    } else if (module == keccak256("FundStorage")) {
      oldAddress = fundStorage;
      require(oldAddress != _newAddress);
      fundStorage = IFundStorage(_newAddress);
    } else {
      revert();
    }
    LogModuleChanged(_module, oldAddress, _newAddress);
    return true;
  }

} // END OF NewFund