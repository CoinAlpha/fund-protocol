pragma solidity ^0.4.13;

import "./NewNavCalculator.sol";
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

  function totalShareSupply()
    returns (uint ethAmsharesount) {}
  function getBalance()
    returns (uint ethAmount) {}
}


// ===================================== NewFund Contract ======================================

contract NewFund is DestructiblePausable {
  using SafeMath for uint;

  // ** FUND BALANCES **
  uint    public totalEthPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in ether
  uint    public totalSharesPendingRedemption;   // total redemption requests not yet processed by the manager, denominated in shares
  uint    public totalEthPendingWithdrawal;      // total payments not yet withdrawn by investors, denominated in shares


  // ========================================= MODULES ==========================================
  // Where possible, fund logic is delegated to the module contracts below, so that they can be patched and upgraded after contract deployment
  IDataFeed           public dataFeed;           // fetching external data like total portfolio value and exchange rates
  IFundStorage        public fundStorage;        // data storage module
  IFundLogic          public fundLogic;          // performing investor actions such as subscriptions, redemptions, and withdrawals
  INewNavCalculator   public navCalculator;      // calculating net asset value


  // ========================================= MODIFIERS =========================================
  modifier onlyExchange {
    require(msg.sender == exchange());
    _;
  }

  modifier onlyManager {
    require(msg.sender == manager());
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

  event LogNavSnapshot(uint shareClass, uint indexed timestamp, uint navPerShare, uint lossCarryforward, uint accumulatedMgmtFees, uint accumulatedAdminFees);

  event LogTransferToExchange(uint ethAmount);
  event LogTransferFromExchange(uint ethAmount);

  event LogTransferInvestor(address oldAddress, address newAddress);
  event LogModuleChanged(string module, address oldAddress, address newAddress);


  // ======================================== CONSTRUCTOR ========================================
  function NewFund(
    address _dataFeed,
    address _fundStorage,
    address _fundLogic,
    address _navCalculator
  )
  {
    // Set the addresses of other wallets/contracts with which this contract interacts
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
    fundLogic = IFundLogic(_fundLogic);
    navCalculator = INewNavCalculator(_navCalculator);
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
    var (ethPendingSubscription, newTotalEthPendingSubscription) = fundLogic.calcRequestEthSubscription(msg.sender, msg.value);
    fundStorage.setEthPendingSubscription(msg.sender, ethPendingSubscription);
    totalEthPendingSubscription = newTotalEthPendingSubscription;

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
    var (ethPendingSubscription, newTotalEthPendingSubscription) = fundLogic.calcEthSubscription(_investor);
    
    var (shareClass, newSharesOwned, newShares, newShareClassSupply, newTotalShareSupply, nav) = fundLogic.calcSubscriptionShares(_investor, 0);
    
    fundStorage.setSubscribeInvestor(_investor, shareClass, newSharesOwned, newShares, newShareClassSupply, newTotalShareSupply);
    
    totalEthPendingSubscription = newTotalEthPendingSubscription;
    address exchangeAddress = exchange();
    exchangeAddress.transfer(ethPendingSubscription);

    LogSubscription("ETH", _investor, shareClass, newShares, nav, dataFeed.usdEth());
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
    var (shareClass, newSharesOwned, newShareClassSupply, newTotalShareSupply, nav) = fundLogic.calcRedeemUsdInvestor(_investor, _shares);
    
    fundStorage.setRedeemInvestor(_investor, shareClass, newSharesOwned, newShareClassSupply, newTotalShareSupply);
    
    LogRedemption("USD", _investor, shareClass, _shares, nav, dataFeed.usdEth());
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
    var (newSharesPendingRedemption, newTotalSharesPendingRedemption) = fundLogic.calcRequestEthRedemption(msg.sender, _shares);
    fundStorage.setEthPendingRedemption(msg.sender, newSharesPendingRedemption);
    totalSharesPendingRedemption = newTotalSharesPendingRedemption;

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
    var (redemptionCancelledShares, newTotalSharesPendingRedemption) = fundLogic.cancelEthRedemption(msg.sender);
    fundStorage.setEthPendingRedemption(msg.sender, 0);
    totalSharesPendingRedemption = newTotalSharesPendingRedemption;

    LogEthRedemptionCancellation(msg.sender, redemptionCancelledShares);
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
    var (shareClass, redeemedShares, newSharesOwned, newShareClassSupply, newTotalShareSupply, nav, redeemedEthAmount) = fundLogic.calcRedeemEthInvestor(_investor);
    
    fundStorage.setRedeemInvestor(_investor, shareClass, newSharesOwned, newShareClassSupply, newTotalShareSupply);
    
    _investor.transfer(redeemedEthAmount);
    
    LogRedemption("ETH", _investor, shareClass, redeemedShares, nav, dataFeed.usdEth());
    LogRedemptionPayment(redeemedEthAmount);
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

  // ====================================== NAV CALCULATION ====================================

  // Calculate NAVs for all Share Classes
  function calcNav()
    onlyOwner
    returns (bool success)
  {
    uint storedFundTotalValue = navCalculator.calcStoredTotalFundValue();

    for (uint8 i = 0; i < fundStorage.numberOfShareClasses(); i++) {
      calcNewShareClassNav(i, storedFundTotalValue);
    }
    return true;    
  }

  // Calculate and update NAV per share, lossCarryforward (the amount of losses that the fund to make up in order to start earning performance fees),
  // and accumulated management fee balaces.
  // Delegates logic to the NavCalculator module
  function calcNewShareClassNav(uint _shareClass, uint _storedFundTotalValue)
    onlyOwner
    returns (bool success)
  {
    var (
      _lastCalcDate,
      _navPerShare,
      _lossCarryforward,
      _accumulatedMgmtFees,
      _accumulatedAdminFees
    ) = navCalculator.calcNewShareClassNav(_shareClass, _storedFundTotalValue);

    fundStorage.setShareClassNav(_shareClass, _lastCalcDate, _navPerShare, _lossCarryforward, _accumulatedMgmtFees, _accumulatedAdminFees);

    LogNavSnapshot(_shareClass, _lastCalcDate, _navPerShare, _lossCarryforward, _accumulatedMgmtFees, _accumulatedAdminFees);
    return true;
  }

  // ========================================= BALANCES ========================================

  // Returns the fund's balance less pending subscriptions and withdrawals
  function getBalance()
    constant
    returns (uint ethAmount)
  {
    return this.balance.sub(totalEthPendingSubscription).sub(totalEthPendingWithdrawal);
  }


  // ==================================== BASIC FUND DETAIL=====================================

  // Returns the fund's total amount of shares outstanding
  function totalShareSupply()
    constant
    public
    returns (uint ethAmsharesount)
  {
    return fundStorage.totalShareSupply();
  }

  // Returns the fund decimals for calculation
  // number of decimals used to display navPerShare
  function decimals()
    constant
    public
    returns (uint)
  {
    return fundStorage.decimals();
  }

  // Returns the fund manager's address
  // Address of the manager account allowed to withdraw base and performance management fees
  function manager()
    constant
    public
    returns (address)
  {
    return fundStorage.manager();
  }

  // Returns the exchange wallet address
  function exchange()
    constant
    public
    returns (address)
  {
    return fundStorage.exchange();
  }

  // ========================================== ADMIN ==========================================

  /**
    * This is an administrative function to manage an investor's
    * request to update a wallet address
    * @param  _oldAddress  Existing investor address    
    * @param  _newAddress  New investor address
    * @return isSuccess    Operation successful
    */

  function transferInvestor(address _oldAddress, address _newAddress)
    onlyManager
    returns (bool isSuccess)
  {
    fundLogic.calcTransferInvestor(_oldAddress, _newAddress);
    fundStorage.transferInvestor(_oldAddress, _newAddress);
    LogTransferInvestor(_oldAddress, _newAddress);
    return true;
  }

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
      navCalculator = INewNavCalculator(_newAddress);
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
} // END OF NewFund