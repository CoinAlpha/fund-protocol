pragma solidity ^0.4.13;

import "./zeppelin/DestructibleModified.sol";

/**
 * @title FundStorage
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev A module for storing all data for the fund
 */

// ==================================== CONTRACT INTERFACE ====================================
contract IFundStorage {
  // Constants
  bytes32  public name;                         // fund name
  bytes32  public symbol;                       // Ethereum token symbol
  uint     public decimals;                     // number of decimals used to display navPerShare
  uint     public minInitialSubscriptionUsd;    // minimum amount of USD that a new investor can subscribe
  uint     public minSubscriptionUsd;           // minimum amount of USD that an existing investor can subscribe
  uint     public minRedemptionShares;          // minimum amount of shares that an investor can request be redeemed

  address  public fundAddress;

  uint     public totalShareSupply;
  uint     public numberOfShareClasses;

  // Modify Fund Details Functions
  function updateMinInitialSubscriptionUsd(uint _minInitialSubscriptionUsd)
    returns (bool wasUpdated) {}
  function updateMinSubscriptionUsd(uint _minSubscriptionUsd)
    returns (bool wasUpdated) {}
  function updateMinRedemptionShares(uint _minRedemptionShares)
    returns (bool wasUpdated) {}

  // Basic investor Functions
  function getInvestorAddresses()
    returns (address[]) {}
  function getInvestor(address _investor)
    returns (
      uint investorType,
      uint ethPendingSubscription,
      uint sharesOwned,
      uint shareClass,
      uint sharesPendingRedemption,
      uint amountPendingWithdrawal
    ) {}
  function getInvestorType(address _investor)
    returns (uint investorType) {}
  
  // Admin functions
  function removeInvestor(address _investor)
    returns (bool success) {}
  function modifyInvestor(
    address _investor,
    uint _investorType,
    uint _ethPendingSubscription,
    uint _sharesOwned,
    uint _shareClass,
    uint _sharesPendingRedemption,
    uint _amountPendingWithdrawal,
    string _description
  ) returns (bool wasModified) {}
  function transferInvestor(address _oldAddress, address _newAddress)
    returns (bool isSuccess) {}

  // Subscription Functions
  function setWhiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    returns(bool wasAdded) {}

  function getUsdSubscriptionData(address _investor)
    returns (uint investorType, uint sharesOwned) {}

  function getEthSubscriptionData(address _investor)
    returns (uint investorType, uint ethPendingSubscription) {}
  function setEthPendingSubscription(address _investor, uint _totalAmount)
    returns(bool wasAdded) {}

  function getSubscriptionShares(address _investor)
    returns (
      uint investorType,
      uint ethPendingSubscription,
      uint sharesOwned,
      uint shareClass
    ) {}
  function setSubscribeInvestor(
    address _investor,
    uint _shareClass,
    uint _newSharesOwned,
    uint _newShares,
    uint _newShareClassSupply,
    uint _newTotalShareSupply
  )
    returns (bool wasModified) {}

  // Redemption Functions
  function getUsdRedemptionData(address _investor)
    returns (uint investorType, uint shareClass, uint sharesOwned) {}

  function getEthRequestRedemptionData(address _investor)
    returns (uint investorType, uint sharesOwned, uint sharesPendingRedemption) {}
  function setEthPendingRedemption(address _investor, uint _sharesPendingRedemption)
    returns (bool isSuccess) {}
  function getEthRedemptionData(address _investor)
    returns (uint investorType, uint shareClass, uint sharesOwned, uint sharesPendingRedemption) {}

  function setRedeemInvestor(
    address _investor,
    uint _shareClass,
    uint _newSharesOwned,
    uint _newShareClassSupply,
    uint _newTotalShareSupply
  )
    returns (bool wasModified)
  {}

  // Share Class Functions
  function getShareClass(uint _shareClassIndex)
    returns (
      uint shareClassIndex,
      uint adminFeeBps,
      uint mgmtFeeBps,
      uint performFeeBps, 
      uint shareSupply,
      uint lastCalc,
      uint shareNav,
      uint accumulatedMgmtFees,
      uint accumulatedAdminFees
    ) {}
  function modifyShareCount(uint _shareClassIndex, uint _shareSupply, uint _totalShareSupply)
    returns (bool wasModified) {}
  function setShareClassNav(uint _shareClassIndex, uint _shareNav)
    returns (bool wasUpdated) {}
  function getShareClassNavPerShare(uint _shareClass)
    returns (uint navPerShare) {}
  function getShareClassSupply(uint _shareClass)
    returns (uint shares) {}
}

// ==================================== CONTRACT ====================================

contract FundStorage is DestructibleModified {

  // Constants set at contract inception
  bytes32  public name;                         // fund name
  bytes32  public symbol;                       // Ethereum token symbol
  uint     public decimals;                     // number of decimals used to display navPerShare
  uint     public minInitialSubscriptionUsd;    // minimum amount of USD that a new investor can subscribe
  uint     public minSubscriptionUsd;           // minimum amount of USD that an existing investor can subscribe
  uint     public minRedemptionShares;          // minimum amount of shares that an investor can request be redeemed
  
  address  public fundAddress;

  // This modifier is applied to all external methods in this contract since only
  // the primary Fund contract can use this module
  modifier onlyFund {
    require(msg.sender == fundAddress);
    _;
  }

  /**
   * @dev Throws if called by any account other than the owners or the fund
   */
  modifier onlyFundOrOwner() {
    bool authorized = false;
    if (msg.sender == fundAddress) {
      authorized = true;
    } else {
      for (uint  i = 0; i < owners.length; i++) {
        if (msg.sender == owners[i]) {
          authorized = true;
          i = owners.length; // escape loop
        }
      }
    }
    require(authorized);
    _;
  }

  // This struct tracks fund-related balances for a specific investor address
  struct InvestorStruct {
    uint investorType;                 // [0] no investor [1] ETH investor [2] USD investor 
    uint ethPendingSubscription;       // Ether deposited by an investor not yet proceessed by the manager
    uint sharesOwned;                  // Balance of shares owned by an investor.  For investors, this is
                                       // identical to the ERC20 balances variable.
    uint shareClass;                   // Investor's fee class
    uint sharesPendingRedemption;      // Redemption requests not yet processed by the manager
    uint amountPendingWithdrawal;      // Payments available for withdrawal by an investor
  }

  mapping(address => InvestorStruct) public investors;
  address[]                                 investorAddresses;

  // This struct tracks different share classes and their terms
  struct ShareClassStruct {
    uint adminFeeBps;
    uint mgmtFeeBps;
    uint performFeeBps; 
    uint shareSupply;                  // In units of 0.01 | 100001 means 1000.01 shares
    uint lastCalc;                     // timeStamp
    uint shareNav;                     // In units of 0.01 = cents
    uint accumulatedMgmtFees;          // Amount in USD cents
    uint accumulatedAdminFees;         // Amount in USD cents
  }

  mapping (uint => ShareClassStruct)  public  shareClasses;
  uint                                public  numberOfShareClasses;
  uint                                public  totalShareSupply;

  // ==================================== EVENTS ====================================

  // Fund Events
  event LogUpdatedDetails(string updatedField, uint oldValue, uint newValue);
  event LogRemovedInvestor(address removedInvestor, uint investorType);
  event LogModifiedStorageInvestor(string description, uint investorType, uint ethPendingSubscription, uint sharesOwned, uint shareClass, uint sharesPendingRedemption, uint amountPendingWithdrawal);

  event LogAddedShareClass(uint shareClassIndex, uint adminFeeBps, uint mgmtFeeBps, uint performFeeBps, uint createdAt, uint numberOfShareClasses);
  event LogModifiedShareClass(uint shareClassIndex, uint adminFeeBps, uint mgmtFeeBps, uint performFeeBps, uint modifiedAt);
  event LogModifiedShareCount(uint shareClassIndex, uint previousShareSupply, uint newShareSupply, uint previousTotalShareSupply, uint newTotalShareSupply);
  event LogUpdateStorageNav(uint shareClassIndex, uint previousNav, uint newNav);

  event LogUpdatedEthPendingSubscription(address indexed investor, uint totalAmount);

  // Administrative Events
  event LogSetFundAddress(address oldFundAddress, address newFundAddress);

  // ==================================== CONSTRUCTOR ====================================
  function FundStorage(
    bytes32  _name,
    bytes32  _symbol,
    uint     _decimals,
    uint     _minInitialSubscriptionUsd,
    uint     _minSubscriptionUsd,
    uint     _minRedemptionShares,
    // DETAILS OF INITIAL SHARE CLASS
    uint     _adminFeeBps,
    uint     _mgmtFeeBps,
    uint     _performFeeBps
  ) // "Falcon", "FALC", 1000000, 500000, 100000, 100, 100, 20000
  {
    name = _name;
    symbol = _symbol;
    decimals = _decimals;
    minSubscriptionUsd = _minSubscriptionUsd;
    minInitialSubscriptionUsd = _minInitialSubscriptionUsd;
    minRedemptionShares = _minRedemptionShares;
    // Create initial base share class
    numberOfShareClasses = 1;
    shareClasses[0] = ShareClassStruct(_adminFeeBps, _mgmtFeeBps, _performFeeBps, 0, now, 10000, 0, 0);
  }


  // ==================================== FUND DETAILS ====================================
  function updateMinInitialSubscriptionUsd(uint _minInitialSubscriptionUsd)
    onlyFund
    returns (bool wasUpdated)
  {
    uint old = minInitialSubscriptionUsd;
    require(old != _minInitialSubscriptionUsd);
    minInitialSubscriptionUsd = _minInitialSubscriptionUsd;
    LogUpdatedDetails("minInitialSubscriptionUsd", old, _minInitialSubscriptionUsd);
    return true;
  }
  
  function updateMinSubscriptionUsd(uint _minSubscriptionUsd)
    onlyFund
    returns (bool wasUpdated)
  {
    uint old = minSubscriptionUsd;
    require(old != _minSubscriptionUsd);
    LogUpdatedDetails("minSubscriptionUsd", old, _minSubscriptionUsd);
    minSubscriptionUsd = _minSubscriptionUsd;
    return true;
  }
  
  function updateMinRedemptionShares(uint _minRedemptionShares)
    onlyFund
    returns (bool wasUpdated)
  {
    uint old = minRedemptionShares;
    require(old != _minRedemptionShares);
    minRedemptionShares = _minRedemptionShares;
    LogUpdatedDetails("minRedemeptionShares", old, _minRedemptionShares);
    return true;
  }

  // ======================================= BASIC INVESTOR FUNCTIONS =======================================

  // Get array of investor addresses
  function getInvestorAddresses()
    constant
    onlyOwner
    returns (address[])
  {
    return investorAddresses;
  }

  // Returns the variables contained in the Investor struct for a given address
  function getInvestor(address _investor)
    constant
    public
    returns (
      uint investorType,
      uint ethPendingSubscription,
      uint sharesOwned,
      uint shareClass,
      uint sharesPendingRedemption,
      uint amountPendingWithdrawal
    )
  {
    InvestorStruct storage investor = investors[_investor];
    return (investor.investorType, investor.ethPendingSubscription, investor.sharesOwned, investor.shareClass, investor.sharesPendingRedemption, investor.amountPendingWithdrawal);
  }

  // Returns the investor type: [0] not whitelisted, [1] Ether investor, [2] USD investor
  function getInvestorType(address _investor)
    constant
    public
    returns (uint investorType)
  {
    return investors[_investor].investorType;
  }

  // ======================================= INVESTOR ADMIN =======================================
  // Remove investor address from list
  function removeInvestor(address _investor)
    onlyFundOrOwner
    returns (bool success)
  {
    require(investors[_investor].investorType > 0);
    InvestorStruct storage investor = investors[_investor];

    require(investor.ethPendingSubscription == 0 && investor.sharesOwned == 0 && investor.sharesPendingRedemption == 0 && investor.amountPendingWithdrawal == 0);

    bool investorWasRemoved;
    for (uint i = 0; i < investorAddresses.length; i++) {
      if (_investor == investorAddresses[i]) {
        // If investor is not the last investor, swap with the last
        if (i < investorAddresses.length - 1) {
          investorAddresses[i] = investorAddresses[investorAddresses.length - 1];
        }
        // Remove last investor
        investorAddresses.length = investorAddresses.length - 1;
        investorWasRemoved = true;

        // escape loop
        i = investorAddresses.length;
      }
    }
    if (!investorWasRemoved) {
      revert();
    }
    investors[_investor] = InvestorStruct(0,0,0,0,0,0);
    LogRemovedInvestor(_investor, investor.investorType);
    return true;
  }

  // Generalized function for use in updating an investor record, used for subscription
  // and redemptions.  Note that all logic should be performed outside of this function
  function modifyInvestor(
    address _investor,
    uint _investorType,
    uint _ethPendingSubscription,
    uint _sharesOwned,
    uint _shareClass,
    uint _sharesPendingRedemption,
    uint _amountPendingWithdrawal,
    string _description
  )
    onlyFund
    returns (bool wasModified)
  {
    require(investors[_investor].investorType > 0);
    investors[_investor] = InvestorStruct(_investorType, _ethPendingSubscription, _sharesOwned, _shareClass, _sharesPendingRedemption, _amountPendingWithdrawal);
    LogModifiedStorageInvestor(_description, _investorType, _ethPendingSubscription, _sharesOwned, _shareClass, _sharesPendingRedemption, _amountPendingWithdrawal);
  }

  /**
    * This is an administrative function to manage an investor's
    * request to update a wallet address
    * @param  _oldAddress  Existing investor address    
    * @param  _newAddress  New investor address
    * @return isSuccess    Operation successful
    */
  function transferInvestor(address _oldAddress, address _newAddress)
    onlyFundOrOwner
    returns (bool isSuccess)
  {
    var (investorType, ethPendingSubscription, sharesOwned, shareClass, sharesPendingRedemption, amountPendingWithdrawal) = getInvestor(_oldAddress);
    investors[_oldAddress] = InvestorStruct(investorType,0,0,0,0,0);
    removeInvestor(_oldAddress);
    setWhiteListInvestor(_newAddress, investorType, shareClass);
    modifyInvestor(_newAddress, investorType, ethPendingSubscription, sharesOwned, shareClass, sharesPendingRedemption, amountPendingWithdrawal, "Transferred Investor");
    return true;
  }

  // =============================== INVESTOR SUBSCRIBE FUNCTIONS ===============================

  // Whitelist an investor and specify investor type: [1] ETH investor | [2] USD investor
  function setWhiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    onlyFund
    returns(bool wasAdded)
  {
    investorAddresses.push(_investor);
    investors[_investor].investorType = _investorType;
    investors[_investor].shareClass = _shareClass;
    LogModifiedStorageInvestor("Whitelist", _investorType, 0, 0, _shareClass, 0, 0);
    return true;
  }

  // Returns the variables required to calculate Usd subscription
  function getUsdSubscriptionData(address _investor)
    constant
    public
    returns (uint investorType, uint sharesOwned)
  {
    return (investors[_investor].investorType, investors[_investor].sharesOwned);
  }

  // Returns the variables required to calculate Eth subscription
  function getEthSubscriptionData(address _investor)
    constant
    public
    returns (uint investorType, uint ethPendingSubscription)
  {
    return (investors[_investor].investorType, investors[_investor].ethPendingSubscription);
  }

  // Add pendingEthSubscription to investor when subscription is requested
  function setEthPendingSubscription(address _investor, uint _totalAmount)
    onlyFund
    returns(bool wasAdded)
  {
    investors[_investor].ethPendingSubscription = _totalAmount;
    LogUpdatedEthPendingSubscription(_investor, _totalAmount);
    return true;
  }

  // Returns the variables required to calculate share subscription
  function getSubscriptionShares(address _investor)
    constant
    public
    returns (
      uint investorType,
      uint ethPendingSubscription,
      uint sharesOwned,
      uint shareClass
    )
  {
    InvestorStruct storage investor = investors[_investor];
    return (investor.investorType, investor.ethPendingSubscription, investor.sharesOwned, investor.shareClass);
  }

  // Update investor data for new subscription
  function setSubscribeInvestor(
    address _investor,
    uint _shareClass,
    uint _newSharesOwned,
    uint _newShares,
    uint _newShareClassSupply,
    uint _newTotalShareSupply
  )
    onlyFund
    returns (bool wasModified)
  {
    require(investors[_investor].investorType > 0 && investors[_investor].shareClass == _shareClass);
    investors[_investor].ethPendingSubscription = 0;
    investors[_investor].sharesOwned = _newSharesOwned;

    modifyShareCount(_shareClass, _newShareClassSupply, _newTotalShareSupply);
    LogModifiedStorageInvestor("Subscription", 999, 0, _newSharesOwned, 999, 999, 999);
    return true;
  }

  // =============================== INVESTOR REDEEM FUNCTIONS ===============================

  // Returns the variables required to calculate Usd redemption
  function getUsdRedemptionData(address _investor)
    constant
    public
    returns (uint investorType, uint shareClass, uint sharesOwned)
  {
    return (investors[_investor].investorType, investors[_investor].shareClass, investors[_investor].sharesOwned);
  }

  // Returns the variables required to calculate Eth redemption request
  function getEthRequestRedemptionData(address _investor)
    constant
    public
    returns (uint investorType, uint sharesOwned, uint sharesPendingRedemption)
  {
    return (investors[_investor].investorType,
            investors[_investor].sharesOwned,
            investors[_investor].sharesPendingRedemption
           );
  }

  // Updates for Eth redemption request
  function setEthPendingRedemption(address _investor, uint _sharesPendingRedemption)
    constant
    public
    returns (bool isSuccess)
  {
    investors[_investor].sharesPendingRedemption = _sharesPendingRedemption;
    return true;
  }

  // Returns the variables required to calculate Eth redemption processing
  function getEthRedemptionData(address _investor)
    constant
    public
    returns (uint investorType, uint shareClass, uint sharesOwned, uint sharesPendingRedemption)
  {
    return (investors[_investor].investorType,
            investors[_investor].shareClass,
            investors[_investor].sharesOwned,
            investors[_investor].sharesPendingRedemption);
  }

  function setRedeemInvestor(
    address _investor,
    uint _shareClass,
    uint _newSharesOwned,
    uint _newShareClassSupply,
    uint _newTotalShareSupply
  )
    onlyFund
    returns (bool wasModified)
  {
    require(investors[_investor].investorType > 0 && investors[_investor].shareClass == _shareClass);
    investors[_investor].sharesOwned = _newSharesOwned;

    modifyShareCount(_shareClass, _newShareClassSupply, _newTotalShareSupply);
    LogModifiedStorageInvestor("Redemption", 999, 999, _newSharesOwned, 999, 999, 999);
    return true;
  }

  // ===================================== SHARECLASS FUNCTIONS =====================================
  
  // Get share class details
  function getShareClass(uint _shareClassIndex)
    constant
    public
    returns (
      uint adminFeeBps,
      uint mgmtFeeBps,
      uint performFeeBps, 
      uint shareSupply,
      uint lastCalc,
      uint shareNav,
      uint accumulatedMgmtFees,
      uint accumulatedAdminFees
    )
  {
    ShareClassStruct storage shareClass = shareClasses[_shareClassIndex];
    return (
      shareClass.adminFeeBps,
      shareClass.mgmtFeeBps,
      shareClass.performFeeBps,
      shareClass.shareSupply,
      shareClass.lastCalc,
      shareClass.shareNav,
      shareClass.accumulatedMgmtFees,
      shareClass.accumulatedAdminFees
    );
  }

  function addShareClass(uint _adminFeeBps, uint _mgmtFeeBps, uint _performFeeBps)
    onlyOwner
    returns (bool wasAdded)
  {
    uint newIndex = numberOfShareClasses;
    shareClasses[newIndex] = ShareClassStruct(_adminFeeBps, _mgmtFeeBps, _performFeeBps, 0, now, 10000, 0, 0);
    numberOfShareClasses += 1;
    LogAddedShareClass(newIndex, _adminFeeBps, _mgmtFeeBps, _performFeeBps, now, numberOfShareClasses);
    return true;
  }

  function modifyShareClassTerms(uint _shareClassIndex, uint _adminFeeBps, uint _mgmtFeeBps, uint _performFeeBps)
    onlyOwner
    returns (bool wasModified)
  {
    // Only amend of no shares are outstanding
    require(_shareClassIndex < numberOfShareClasses && shareClasses[_shareClassIndex].shareSupply == 0);
    shareClasses[_shareClassIndex].adminFeeBps = _adminFeeBps;
    shareClasses[_shareClassIndex].mgmtFeeBps = _mgmtFeeBps;
    shareClasses[_shareClassIndex].performFeeBps = _performFeeBps;
    LogModifiedShareClass(_shareClassIndex, _adminFeeBps, _mgmtFeeBps, _performFeeBps, now);
    return true;
  }

  function modifyShareCount(uint _shareClassIndex, uint _newShareSupply, uint _newTotalShareSupply)
    onlyFund
    returns (bool wasModified)
  {
    require(_shareClassIndex < numberOfShareClasses);
    uint previousShareSupply = shareClasses[_shareClassIndex].shareSupply;
    uint previousTotalShareSupply = totalShareSupply;
    shareClasses[_shareClassIndex].shareSupply = _newShareSupply;
    totalShareSupply = _newTotalShareSupply;
    LogModifiedShareCount(_shareClassIndex, previousShareSupply, _newShareSupply, previousTotalShareSupply, _newTotalShareSupply);
    return true;
  }

  function setShareClassNav(uint _shareClassIndex, uint _shareNav)
    onlyFund
    returns (bool wasUpdated)
  {
    require(_shareClassIndex < numberOfShareClasses);
    uint previousNav = shareClasses[_shareClassIndex].shareNav;
    shareClasses[_shareClassIndex].shareNav = _shareNav;
    shareClasses[_shareClassIndex].lastCalc = now;
    LogUpdateStorageNav(_shareClassIndex, previousNav, _shareNav);
    return true;
  }

  // Get NAV per Share for specified ShareClass
  function getShareClassNavPerShare(uint _shareClass)
    constant
    returns (uint navPerShare)
  {
    require(_shareClass < numberOfShareClasses);
    return shareClasses[_shareClass].shareNav;
  }

  // Get NAV per Share for specified ShareClass
  function getShareClassSupply(uint _shareClass)
    constant
    returns (uint shares)
  {
    require(_shareClass < numberOfShareClasses);
    return shareClasses[_shareClass].shareSupply;
  }

  // =========================================== ADMIN ===========================================

  // Update the address of the Fund contract
  function setFund(address _fundAddress)
    onlyOwner
  {
    require(_fundAddress != fundAddress && _fundAddress != address(0));
    address oldFundAddress = fundAddress;
    fundAddress = _fundAddress;
    LogSetFundAddress(oldFundAddress, _fundAddress);
  }

}