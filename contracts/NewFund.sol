pragma solidity ^0.4.13;

import "./NavCalculator.sol";
import "./FundLogic.sol";
import "./DataFeed.sol";
import "./FundStorage.sol";
import "./math/SafeMath.sol";
import "./zeppelin/DestructiblePausable.sol";


// ==================================== NewFund Interface ======================================

contract INewFund {
  uint    public totalEthPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in ether
  uint    public totalEthPendingWithdrawal;      // total payments not yet withdrawn by investors, denominated in shares
  uint    public totalSharesPendingRedemption;   // total redemption requests not yet processed by the manager, denominated in shares
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
  uint    public totalSharesPendingRedemption;   // total redemption requests not yet processed by the manager, denominated in shares
  uint    public totalEthPendingWithdrawal;      // total payments not yet withdrawn by investors, denominated in shares
  uint    public totalSupply;                    // total number of shares outstanding


  // ========================================= MODULES ==========================================
  // Where possible, fund logic is delegated to the module contracts below, so that they can be patched and upgraded after contract deployment
  INavCalculator      public navCalculator;         // calculating net asset value
  IFundLogic          public fundLogic;             // performing investor actions such as subscriptions, redemptions, and withdrawals
  IDataFeed           public dataFeed;              // fetching external data like total portfolio value and exchange rates
  IFundStorage        public fundStorage;           // data storage module


  // ========================================= MODIFIERS =========================================
  modifier onlyExchange {
    require(msg.sender == exchange);
    _;
  }

  modifier onlyManager {
    require(msg.sender == manager);
    _;
  }


  // ========================================== EVENTS ===========================================

  event LogWhiteListInvestor(address indexed investor, uint investorType, uint shareClass);
  event LogEthSubscriptionRequest(address indexed investor, uint _eth);
  event LogCancelEthSubscriptionRequest(address indexed investor, uint _eth);
  event LogSubscription(string currency, address indexed investor, uint shareClass, uint newShares, uint nav, uint USDETH);
  
  event LogEthRedemptionRequest(address indexed investor, uint shares);
  event LogEthRedemptionCancellation(address indexed investor, uint shares);
  event LogRedemption(string currency, address indexed investor, uint shareClass, uint shares, uint nav, uint USDETH);
  event LogRedemptionPayment(uint ethAmount);

  event LogTransferToExchange(uint ethAmount);
  event LogTransferFromExchange(uint ethAmount);

  event LogModuleChanged(string module, address oldAddress, address newAddress);


  // ======================================== CONSTRUCTOR ========================================
  function NewFund(
    address _manager,
    address _exchange,
    address _navCalculator,
    address _fundLogic,
    address _dataFeed,
    address _fundStorage
  )
  {

    // Set the addresses of other wallets/contracts with which this contract interacts
    manager = _manager;
    exchange = _exchange;
    navCalculator = INavCalculator(_navCalculator);
    fundLogic = IFundLogic(_fundLogic);
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
  }  // End of constructor

  // ====================================== SUBSCRIPTIONS ======================================

  /**
    * Whitelists investor: set type & share class for a new investor
    * This is for data reporting and tracking only
    * Actual USD fund flows are handled off-chain
    * @param  _investor       USD investor address UID or ETH wallet address
    * @param  _investorType   [1] ETH investor | [2] USD investor
    * @param  _shareClass     Share class index
    * @return isSuccess       Operation successful
    */
  function whiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    onlyManager
    returns (bool isSuccess)
  {
    // Check whitelist conditions
    fundLogic.calcWhiteListInvestor(_investor, _investorType, _shareClass);
    fundStorage.setWhiteListInvestor(_investor, _investorType, _shareClass);
    LogWhiteListInvestor(_investor, _investorType, _shareClass);
    return true;
  }

  /**
    * ETH investor function: issue a subscription request by transferring ether into
    * the fund
    * @return isSuccess       Operation successful
    */
  function requestEthSubscription()
    whenNotPaused
    payable
    returns (bool isSuccess)
  {
    var (_ethPendingSubscription, _totalEthPendingSubscription) = fundLogic.calcRequestEthSubscription(msg.sender, msg.value);
    fundStorage.setEthPendingSubscription(msg.sender, _ethPendingSubscription);
    totalEthPendingSubscription = _totalEthPendingSubscription;

    LogEthSubscriptionRequest(msg.sender, msg.value);
    return true;
  }

  /** 
    * Cancel pendingEthSubscription and transfer back funds to investor
    * Delegates logic to the InvestorActions module
    * @return isSuccess       Operation successful
    */
  function cancelEthSubscription()
    whenNotPaused
    returns (bool isSuccess)
  {
    var (cancelledEthAmount, newTotalEthPendingSubscription) = fundLogic.cancelEthSubscription(msg.sender);
    fundStorage.setEthPendingSubscription(msg.sender, 0);
    totalEthPendingSubscription = newTotalEthPendingSubscription;

    msg.sender.transfer(cancelledEthAmount);

    LogCancelEthSubscriptionRequest(msg.sender, cancelledEthAmount);
    return true;
  }

  /**
    * Subscribe USD investor
    * This is for data reporting and tracking only
    * Actual USD fund flows are handled off-chain
    * @param  _investor       USD investor address UUID
    * @param  _usdAmount      USD amount in cents, 1 = $0.01
    * @return wasSubscribed   Operation successful
    */
  function subscribeUsdInvestor(address _investor, uint _usdAmount)
    onlyManager
    returns (bool wasSubscribed)
  {
    // Check conditions for valid USD subscription
    require(fundLogic.calcUsdSubscription(_investor, _usdAmount));

    var (_shareClass, _newSharesOwned, _newShares, _newShareClassSupply, _newTotalShareSupply, _nav) = fundLogic.calcSubscriptionShares(_investor, _usdAmount);
    
    fundStorage.setSubscribeInvestor(_investor, _shareClass, _newSharesOwned, _newShares, _newShareClassSupply, _newTotalShareSupply);
    
    totalSupply = _newTotalShareSupply;
    
    LogSubscription("USD", _investor, _shareClass, _newShares, _nav, dataFeed.usdEth());
    return true;
  }

  /**
    * Subscribe ETH investor
    * Transfer subscription funds into exchange account
    * @param  _investor    ETH wallet address
    * @return wasSubscribed   Operation successful
    */
  function subscribeEthInvestor(address _investor)
    onlyManager
    returns (bool wasSubscribed)
  {
    // Calculate new totalEthPendingSubscription as well as check ETH Investor conditions
    var (ethPendingSubscription, _totalEthPendingSubscription) = fundLogic.calcEthSubscription(_investor);
    
    var (_shareClass, _newSharesOwned, _newShares, _newShareClassSupply, _newTotalShareSupply, _nav) = fundLogic.calcSubscriptionShares(_investor, 0);
    
    fundStorage.setSubscribeInvestor(_investor, _shareClass, _newSharesOwned, _newShares, _newShareClassSupply, _newTotalShareSupply);
    
    totalSupply = _newTotalShareSupply;
    totalEthPendingSubscription = _totalEthPendingSubscription;
    exchange.transfer(ethPendingSubscription);

    LogSubscription("ETH", _investor, _shareClass, _newShares, _nav, dataFeed.usdEth());
    LogTransferToExchange(ethPendingSubscription);
    return true;
  }

  // ====================================== REDEMPTIONS ======================================


  // Returns the total redemption requests not yet processed by the manager, denominated in ether
  function totalEthPendingRedemption()
    constant
    returns (uint)
  {
    // TODO:
    // return fundLogic.sharesToEth(totalSharesPendingRedemption);
  }


  /**
    * Redeem USD investor
    * This is for data reporting and tracking only
    * Actual USD fund flows are handled off-chain
    * @param  _investor    USD investor address UUID
    * @param  _shares      Share amount in decimal 0.01 unties: 1 = 0.01 shares
    * @return wasRedeemed  Operation successful
    */
  function redeemUsdInvestor(address _investor, uint _shares)
    onlyManager
    returns (bool wasRedeemed)
  {
    // Check conditions for valid USD redemption and calculate change in shares
    var (_shareClass, _newSharesOwned, _newShareClassSupply, _newTotalShareSupply, _nav) = fundLogic.calcRedeemUsdInvestor(_investor, _shares);
    
    fundStorage.setRedeemInvestor(_investor, _shareClass, _newSharesOwned, _newShareClassSupply, _newTotalShareSupply);
    
    totalSupply = _newTotalShareSupply;
    
    LogRedemption("USD", _investor, _shareClass, _shares, _nav, dataFeed.usdEth());
    return true;
  }

  /**
    * ETH investor function: issue a redemption request
    * @param  _shares      Share amount in decimal 0.01 unties: 1 = 0.01 shares
    * @return isSuccess    Operation successful
    */
  function requestEthRedemption(uint _shares)
    whenNotPaused
    returns (bool isSuccess)
  {
    var (_newSharesPendingRedemption, _totalSharesPendingRedemption) = fundLogic.calcRequestEthRedemption(msg.sender, _shares);
    fundStorage.setEthPendingRedemption(msg.sender, _newSharesPendingRedemption);
    totalSharesPendingRedemption = _totalSharesPendingRedemption;

    LogEthRedemptionRequest(msg.sender, _shares);
    return true;
  }

  /** 
    * ETH investor function: cancel redemption request
    * @return isSuccess    Operation successful
    */
  function cancelEthRedemption()
    whenNotPaused
    returns (bool isSuccess)
  {
    var (_redemptionCancelledShares, _totalSharesPendingRedemption) = fundLogic.cancelEthRedemption(msg.sender);
    fundStorage.setEthPendingRedemption(msg.sender, 0);
    totalSharesPendingRedemption = _totalSharesPendingRedemption;

    LogEthRedemptionCancellation(msg.sender, _redemptionCancelledShares);
    return true;
  }

  /**
    * Redeem ETH investor
    * Calculate shares, payment amount, and transfers Eth to investor
    * @param  _investor    USD investor address UUID
    * @return isSuccess    Operation successful
    */
  function redeemEthInvestor(address _investor)
    onlyManager
    returns (bool isSuccess)
  {
    // Check conditions for valid USD redemption and calculate change in shares
    var (_shareClass, _redeemedShares, _newSharesOwned, _newShareClassSupply, _newTotalShareSupply, _nav, _redeemedEthAmount) = fundLogic.calcRedeemEthInvestor(_investor);
    
    fundStorage.setRedeemInvestor(_investor, _shareClass, _newSharesOwned, _newShareClassSupply, _newTotalShareSupply);
    
    totalSupply = _newTotalShareSupply;
    _investor.transfer(_redeemedEthAmount);
    
    LogRedemption("ETH", _investor, _shareClass, _redeemedShares, _nav, dataFeed.usdEth());
    LogRedemptionPayment(_redeemedEthAmount);
    return true;
  }

  // Non-payable fallback function so that any attempt to send ETH directly to the contract is thrown
  // TODO: handle receipt from non-whitelisted investor
  function ()
    payable
    onlyExchange
  { remitFromExchange(); }

  // Utility function for exchange to send funds to contract
  function remitFromExchange()
    payable
    onlyExchange
    returns (bool success)
  {
    LogTransferFromExchange(msg.value);
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
    } else if (module == keccak256("FundLogic")) {
      oldAddress = fundLogic;
      require(oldAddress != _newAddress);
      fundLogic = IFundLogic(_newAddress);
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


  // ********* HELPERS *********

  // Returns the fund's balance less pending subscriptions and withdrawals
  function getBalance()
    constant
    returns (uint ethAmount)
  {
    return this.balance.sub(totalEthPendingSubscription).sub(totalEthPendingWithdrawal);
  }

} // END OF NewFund