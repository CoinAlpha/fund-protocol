pragma solidity ^0.4.13;

import "./NavCalculator.sol";
import "./InvestorActions.sol";
import "./DataFeed.sol";
import "./FundStorage.sol";
import "./math/SafeMath.sol";
import "./zeppelin/DestructiblePausable.sol";

contract NewFund is DestructiblePausable {
  using SafeMath for uint;

  // ** CONSTANTS ** set at contract inception
  string  public name;                         // fund name
  string  public symbol;                       // Ethereum token symbol
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
  INavCalculator   public navCalculator;         // calculating net asset value
  IInvestorActions public investorActions;       // performing investor actions such as subscriptions, redemptions, and withdrawals
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

  event LogWhiteListInvestor(address investor, uint investorType);

  event LogModuleChanged(string module, address oldAddress, address newAddress);

  // ======================================== CONSTRUCTOR ========================================
  function NewFund(
    address _manager,
    address _exchange,
    address _navCalculator,
    address _investorActions,
    address _dataFeed,
    address _fundStorage,
    string  _name,
    string  _symbol,
    uint    _decimals
  )
  {
    // Constants
    name = _name;
    symbol = _symbol;
    decimals = _decimals;

    // Set the addresses of other wallets/contracts with which this contract interacts
    manager = _manager;
    exchange = _exchange;
    navCalculator = INavCalculator(_navCalculator);
    investorActions = IInvestorActions(_investorActions);
    dataFeed = IDataFeed(_dataFeed);
    fundStorage = IFundStorage(_fundStorage);
  }  // End of constructor

  // ====================================== SUBSCRIPTIONS ======================================

  // Whitelist an investor
  // TODO: Delegates logic to the InvestorActions module
  function whiteListInvestor(address _investor, uint _investorType)
    onlyOwner
    returns (bool isSuccess)
  {
    fundStorage.addInvestor(_investor, _investorType);
    LogWhiteListInvestor(_investor, _investorType);
    return true;
  }


  // ========================================== ADMIN ==========================================

  // Update the address of the fundStorage contract
  function setFundStorage(address _fundStorage) 
    onlyOwner
    returns (bool success) 
  {
    require(_fundStorage != address(0) && _fundStorage != address(fundStorage));
    address old = fundStorage;
    fundStorage = IFundStorage(_fundStorage);
    LogModuleChanged("FundStorage", old, _fundStorage);
    return true;
  }

} // END OF NewFund