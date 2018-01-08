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

  // Fund Details Functions
  function updateMinInitialSubscriptionUsd(uint _minInitialSubscriptionUsd)
    returns (bool wasUpdated) {}
  function updateMinSubscriptionUsd(uint _minSubscriptionUsd)
    returns (bool wasUpdated) {}
  function updateMinRedemptionShares(uint _minRedemptionShares)
    returns (bool wasUpdated) {}

  // Investor Functions
  function whiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    returns(bool wasAdded) {}
  function removeInvestor(address _investor)
    returns (bool success) {}
  function modifyInvestor(
    address _investor,
    uint _investorType,
    uint _amountPendingSubscription,
    uint _sharesOwned,
    uint _shareClass,
    uint _sharesPendingRedemption,
    uint _amountPendingWithdrawal,
    string _description
  ) returns (bool wasModified) {}
  function getInvestor(address _investor)
    returns (
      uint investorType,
      uint amountPendingSubscription,
      uint sharesOwned,
      uint shareClass,
      uint sharesPendingRedemption,
      uint amountPendingWithdrawal
    ) {}
  
  // Subscribe / Redeem Functions
  function updateEthPendingSubscription(address _investor, uint _totalAmount)
    returns(bool wasAdded) {}

  // Share Class Functions
  function getShareClass(uint _shareClassIndex)
    returns (
      uint shareClassIndex,
      uint adminFeeBps,
      uint mgmtFeeBps,
      uint performFeeBps, 
      uint shareSupply,
      uint shareNav,
      uint lastCalc
    ) {}
  function modifyShareCount(uint _shareClassIndex, uint _shareSupply, uint _totalShareSupply)
    returns (bool wasModified) {}
  function updateNav(uint _shareClassIndex, uint _shareNav)
    returns (bool wasUpdated) {}
  function getShareClassNavPerShare(uint _shareClass)
    returns (uint navPerShare) {}
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
    uint amountPendingSubscription;    // Ether deposited by an investor not yet proceessed by the manager
    uint sharesOwned;                  // Balance of shares owned by an investor.  For investors, this is
                                       // identical to the ERC20 balances variable.
    uint shareClass;                   // Investor's fee class
    uint sharesPendingRedemption;      // Redemption requests not yet processed by the manager
    uint amountPendingWithdrawal;      // Payments available for withdrawal by an investor
  }

  mapping(address => InvestorStruct) public investors;
  address[]                                 investorAddresses;
  mapping(address => uint)                  containsInvestor;  // [0] no investor [1] ETH investor [2] USD investor 

  // This struct tracks different share classes and their terms
  struct ShareClassStruct {
    uint adminFeeBps;
    uint mgmtFeeBps;
    uint performFeeBps; 
    uint shareSupply;                  // In units of 0.01 | 100001 means 1000.01 shares
    uint shareNav;                     // In units of 0.01 = cents
    uint lastCalc;                     // timeStamp
  }

  mapping (uint => ShareClassStruct)  public  shareClasses;
  uint                                public  numberOfShareClasses;
  uint                                public  totalShareSupply;

  // Fund Events
  event LogUpdatedDetails(string updatedField, uint oldValue, uint newValue);
  event LogWhiteListedInvestor(address newInvestor, uint investorType, uint shareClass);
  event LogRemovedInvestor(address removedInvestor, uint investorType);
  event LogModifiedInvestor(string _description, uint _investorType, uint _amountPendingSubscription, uint _sharesOwned, uint _shareClass, uint _sharesPendingRedemption, uint _amountPendingWithdrawal);

  event LogAddedShareClass(uint shareClassIndex, uint adminFeeBps, uint mgmtFeeBps, uint performFeeBps, uint createdAt, uint numberOfShareClasses);
  event LogModifiedShareClass(uint shareClassIndex, uint adminFeeBps, uint mgmtFeeBps, uint performFeeBps, uint modifiedAt);
  event LogModifiedShareCount(uint shareClassIndex, uint previousShareSupply, uint previousTotalShareSupply, uint newShareSupply, uint newTotalShareSupply);
  event LogNavUpdate(uint shareClassIndex, uint previousNav, uint newNav);

  // Investor Events
  event LogUpdatedAmountPendingSubscription(string _type, address investor, uint totalAmount);

  // Administrative Events
  event LogSetFundAddress(address oldFundAddress, address newFundAddress);

  // ***** Constructor *****
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
    shareClasses[0] = ShareClassStruct(_adminFeeBps, _mgmtFeeBps, _performFeeBps, 0, 10000, now);
  }


  // ********* FUND DETAIL FUNCTIONS *********
  
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


  // ********* INVESTOR FUNCTIONS *********

  // [INVESTOR METHOD] Returns the variables contained in the Investor struct for a given address
  function getInvestor(address _investor)
    constant
    public
    returns (
      uint investorType,
      uint amountPendingSubscription,
      uint sharesOwned,
      uint shareClass,
      uint sharesPendingRedemption,
      uint amountPendingWithdrawal
    )
  {
    InvestorStruct storage investor = investors[_investor];
    return (investor.investorType, investor.amountPendingSubscription, investor.sharesOwned, investor.shareClass, investor.sharesPendingRedemption, investor.amountPendingWithdrawal);
  }

  // Remove investor address from list
  function removeInvestor(address _investor)
    onlyFundOrOwner
    returns (bool success)
  {
    require(containsInvestor[_investor] > 0);
    InvestorStruct storage investor = investors[_investor];

    require(investor.amountPendingSubscription == 0 && investor.sharesOwned == 0 && investor.sharesPendingRedemption == 0 && investor.amountPendingWithdrawal == 0);

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
    containsInvestor[_investor] = 0;
    investors[_investor] = InvestorStruct(0,0,0,0,0,0);
    LogRemovedInvestor(_investor, investor.investorType);
    return true;
  }

  function queryContainsInvestor(address _investor)
    constant
    public
    returns (uint investorType)
  {
    return containsInvestor[_investor];
  }

  function getInvestorAddresses()
    constant
    onlyOwner
    returns (address[])
  {
    return investorAddresses;
  }

  // Generalized function for use in updating an investor record, used for subscription
  // and redemptions.  Note that all logic should be performed outside of this function
  function modifyInvestor(
    address _investor,
    uint _investorType,
    uint _amountPendingSubscription,
    uint _sharesOwned,
    uint _shareClass,
    uint _sharesPendingRedemption,
    uint _amountPendingWithdrawal,
    string _description
  )
    onlyFund
    returns (bool wasModified)
  {
    require(containsInvestor[_investor] > 0);
    investors[_investor] = InvestorStruct(_investorType, _amountPendingSubscription, _sharesOwned, _shareClass, _sharesPendingRedemption, _amountPendingWithdrawal);
    LogModifiedInvestor(_description, _investorType, _amountPendingSubscription, _sharesOwned, _shareClass, _sharesPendingRedemption, _amountPendingWithdrawal);
  }

  // ********* INVESTOR SUBSCRIBE FUNCTIONS *********

  // Whitelist an investor and specify investor type: [1] ETH investor | [2] USD investor
  // TODO: move logic to newInvestorActions
  function whiteListInvestor(address _investor, uint _investorType, uint _shareClass)
    onlyFundOrOwner
    returns(bool wasAdded)
  {
    require(containsInvestor[_investor] == 0 && _investorType > 0 && _investorType < 3 && _shareClass < numberOfShareClasses);
    containsInvestor[_investor] = _investorType;
    investorAddresses.push(_investor);
    investors[_investor].investorType = _investorType;
    investors[_investor].shareClass = _shareClass;
    LogWhiteListedInvestor(_investor, _investorType, _shareClass);
    return true;
  }

  // Add pendingEthSubscription to investor when subscription is requested
  function updateEthPendingSubscription(address _investor, uint _totalAmount)
    onlyFund
    returns(bool wasAdded)
  {
    investors[_investor].amountPendingSubscription = _totalAmount;
    LogUpdatedAmountPendingSubscription("ETH", _investor, _totalAmount);
    return true;
  }

  // ********* INVESTOR SHARE FUNCTIONS *********


  // ********* SHARECLASS FUNCTIONS *********
  
  // Get share class details
  function getShareClass(uint _shareClassIndex)
    constant
    public
    returns (
      uint shareClassIndex,
      uint adminFeeBps,
      uint mgmtFeeBps,
      uint performFeeBps, 
      uint shareSupply,
      uint shareNav,
      uint lastCalc
    )
  {
    ShareClassStruct storage shareClass = shareClasses[_shareClassIndex];
    return (
      _shareClassIndex,
      shareClass.adminFeeBps,
      shareClass.mgmtFeeBps,
      shareClass.performFeeBps,
      shareClass.shareSupply,
      shareClass.shareNav,
      shareClass.lastCalc
    );
  }

  function addShareClass(uint _adminFeeBps, uint _mgmtFeeBps, uint _performFeeBps)
    onlyOwner
    returns (bool wasAdded)
  {
    uint newIndex = numberOfShareClasses;
    shareClasses[newIndex] = ShareClassStruct(_adminFeeBps, _mgmtFeeBps, _performFeeBps, 0, 10000, now);
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

  function modifyShareCount(uint _shareClassIndex, uint _shareSupply, uint _totalShareSupply)
    onlyFund
    returns (bool wasModified)
  {
    require(_shareClassIndex < numberOfShareClasses);
    uint previousShareSupply = shareClasses[_shareClassIndex].shareSupply;
    uint previousTotalShareSupply = totalShareSupply;
    shareClasses[_shareClassIndex].shareSupply = _shareSupply;
    totalShareSupply = _totalShareSupply;
    LogModifiedShareCount(_shareClassIndex, previousShareSupply, previousTotalShareSupply, _shareSupply, _totalShareSupply);
    return true;
  }

  function updateNav(uint _shareClassIndex, uint _shareNav)
    onlyFund
    returns (bool wasUpdated)
  {
    require(_shareClassIndex < numberOfShareClasses);
    uint previousNav = shareClasses[_shareClassIndex].shareNav;
    shareClasses[_shareClassIndex].shareNav = _shareNav;
    shareClasses[_shareClassIndex].lastCalc = now;
    LogNavUpdate(_shareClassIndex, previousNav, _shareNav);
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

  // ********* ADMIN *********

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