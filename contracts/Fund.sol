pragma solidity ^0.4.13;

import "./NavCalculator.sol";
import "./InvestorActions.sol";
import "./math/SafeMath.sol";
import "./zeppelin/DestructiblePausable.sol";
import './zeppelin/ERC20.sol';

/**
 * @title Fund
 * @author CoinAlpha, Inc. <contact@coinalpha.com>
 *
 * @dev A blockchain protocol for managed funds.
 * This protocol enables managers to create a blockchain-based asset management vehicle
 * that manages external funds contributed by investors. The protocol utilizes the blockchain
 * to perform functions such as segregated asset custody, net asset value calculation,
 * fee accounting, and subscription/redemption management.
 *
 * The goal of this project is to eliminate the setup and operational costs imposed by middlemen
 * in traditional funds, while maximizing transparency and mitigating fraud risk for investors.
 */

contract Fund is ERC20, DestructiblePausable {
  using SafeMath for uint;

  // Constants set at contract inception
  string  public name;                         // fund name
  string  public symbol;                       // Ethereum token symbol
  uint8   public decimals;                     // number of decimals used to display number of tokens owned
  uint    public minInitialSubscriptionEth;    // minimum amount of ether that a new investor can subscribe
  uint    public minSubscriptionEth;           // minimum amount of ether that an existing investor can subscribe
  uint    public minRedemptionShares;          // minimum amount of shares that an investor can request be redeemed
  uint    public mgmtFeeBps;                   // annual base management fee, in basis points
  uint    public performFeeBps;                // performance management fee earned on gains, in basis points
  address public exchange;                     // address of the exchange account where the manager conducts trading.

  // Variables that are updated after each call to the calcNav function
  uint    public lastCalcDate;
  uint    public navPerShare;
  uint    public accumulatedMgmtFees;
  uint    public accumulatedPerformFees;
  uint    public lossCarryforward;

  // Fund Balances
  uint    public totalEthPendingSubscription;    // total subscription requests not yet processed by the manager, denominated in ether
  uint    public totalSharesPendingRedemption;   // total redemption requests not yet processed by the manager, denominated in shares
  uint    public totalEthPendingWithdrawal;      // total payments not yet withdrawn by investors, denominated in shares
  // uint public totalSupply;                    // (ERC20 variable) total number of shares outstanding

  // Modules: where possible, fund logic is delegated to the module contracts below, so that they can be patched and upgraded after contract deployment
  NavCalculator   public navCalculator;         // calculating net asset value
  InvestorActions public investorActions;       // performing investor actions such as subscriptions, redemptions, and withdrawals

  // This struct tracks fund-related balances for a specific investor address
  struct Investor {
    uint ethTotalAllocation;                  // Total allocation allowed for an investor, denominated in ether
    uint ethPendingSubscription;              // Ether deposited by an investor not yet proceessed by the manager
    uint sharesOwned;                         // Balance of shares owned by an investor.  For investors, this is identical to the ERC20 balances variable.
    uint sharesPendingRedemption;             // Redemption requests not yet processed by the manager
    uint ethPendingWithdrawal;                // Payments available for withdrawal by an investor
  }
  mapping (address => Investor) public investors;
  address[] investorAddresses;

  // Events
  event LogAllocationModification(address indexed investor, uint eth);
  event LogSubscriptionRequest(address indexed investor, uint eth);
  event LogSubscriptionCancellation(address indexed investor);
  event LogSubscription(address indexed investor, uint shares, uint navPerShare);
  event LogRedemptionRequest(address indexed investor, uint shares);
  event LogRedemptionCancellation(address indexed investor);
  event LogRedemption(address indexed investor, uint shares, uint navPerShare);
  event LogLiquidation(address indexed investor, uint shares, uint navPerShare);
  event LogWithdrawal(address indexed investor, uint eth);
  event LogWithdrawalForInvestor(address indexed investor, uint eth);
  event LogNavSnapshot(uint indexed timestamp, uint navPerShare, uint lossCarryforward, uint accumulatedMgmtFees, uint accumulatedPerformFees);
  event LogExchangeAddressChanged(address oldAddress, address newAddress);
  event LogNavCalculatorModuleChanged(address oldAddress, address newAddress);
  event LogInvestorActionsModuleChanged(address oldAddress, address newAddress);
  event LogTransferToExchange(uint amount);
  event LogTransferFromExchange(uint amount);
  event LogManagementFeeWithdrawal(uint amount);

  // Modifiers
  modifier onlyFromExchange {
    require(msg.sender == exchange);
    _;
  }

  /**
  * @dev Constructor function that creates a fund
  * This function is payable and treats any ether sent as part of the manager's own investment in the fund.
  */
  function Fund(
    address _exchange,
    address _navCalculator,
    address _investorActions,
    string  _name,
    string  _symbol,
    uint8   _decimals,
    uint    _minInitialSubscriptionEth,
    uint    _minSubscriptionEth,
    uint    _minRedemptionShares,
    uint    _mgmtFeeBps,
    uint    _performFeeBps
  )
    payable
  {
    // Constants
    name = _name;
    symbol = _symbol;
    decimals = _decimals;
    minSubscriptionEth = _minSubscriptionEth;
    minInitialSubscriptionEth = _minInitialSubscriptionEth;
    minRedemptionShares = _minRedemptionShares;
    mgmtFeeBps = _mgmtFeeBps;
    performFeeBps = _performFeeBps;

    // Set the addresses of other wallets/contracts with which this contract interacts
    exchange = _exchange;
    navCalculator = NavCalculator(_navCalculator);
    investorActions = InvestorActions(_investorActions);

    // Set the initial net asset value calculation variables
    lastCalcDate = now;
    navPerShare = 10000;
    lossCarryforward = 0;
    accumulatedMgmtFees = 0;
    accumulatedPerformFees = 0;

    // Treat funds sent and exchange balance at fund inception as the manager's own investment
    // These amounts are included in fee calculations since it's assumed that the fees are going to the
    // manager anyway
    uint managerInvestment = exchange.balance.add(msg.value);
    totalSupply = managerInvestment;
    balances[msg.sender] = managerInvestment;
    LogTransferToExchange(managerInvestment);

    // Send any funds in  to exchange address
    exchange.transfer(msg.value);
  }

  // [INVESTOR METHOD] Returns the variables contained in the Investor struct for a given address
  function getInvestor(address _addr)
    constant
    returns (
      uint ethTotalAllocation,
      uint ethPendingSubscription,
      uint sharesOwned,
      uint sharesPendingRedemption,
      uint ethPendingWithdrawal
    )
  {
    Investor storage investor = investors[_addr];
    return (investor.ethTotalAllocation, investor.ethPendingSubscription, investor.sharesOwned, investor.sharesPendingRedemption, investor.ethPendingWithdrawal);
  }

  // ********* SUBSCRIPTIONS *********

  // Modifies the max investment limit allowed for an investor
  // Delegates logic to the InvestorActions module
  function modifyAllocation(address _addr, uint _allocation)
    onlyOwner
    returns (bool success)
  {
    // Adds the investor to investorAddresses array if their previous allocation was zero
    if (investors[_addr].ethTotalAllocation == 0) {

      // Check if address already exists before adding
      bool addressExists;
      for (uint i = 0; i < investorAddresses.length; i++) {
        if (_addr == investorAddresses[i]) {
          addressExists = true;
          i = investorAddresses.length;
        }
      }
      if (!addressExists) {
        investorAddresses.push(_addr);
      }
    }
    uint ethTotalAllocation = investorActions.modifyAllocation(_addr, _allocation);
    investors[_addr].ethTotalAllocation = ethTotalAllocation;

    LogAllocationModification(_addr, _allocation);
    return true;
  }

  // Fallback function which calls the requestSubscription function.
  function ()
    whenNotPaused
    payable
  { requestSubscription(); }

  // [INVESTOR METHOD] Issue a subscription request by transferring ether into the fund
  // Delegates logic to the InvestorActions module
  function requestSubscription()
    whenNotPaused
    payable
    returns (bool success)
  {
    var (_ethPendingSubscription, _totalEthPendingSubscription) = investorActions.requestSubscription(msg.sender, msg.value);
    investors[msg.sender].ethPendingSubscription = _ethPendingSubscription;
    totalEthPendingSubscription = _totalEthPendingSubscription;

    LogSubscriptionRequest(msg.sender, msg.value);
    return true;
  }

  // [INVESTOR METHOD] Cancels a subscription request
  // Delegates logic to the InvestorActions module
  function cancelSubscription()
    whenNotPaused
    returns (bool success)
  {
    var (_ethPendingSubscription, _ethPendingWithdrawal, _totalEthPendingSubscription, _totalEthPendingWithdrawal) = investorActions.cancelSubscription(msg.sender);
    investors[msg.sender].ethPendingSubscription = _ethPendingSubscription;
    investors[msg.sender].ethPendingWithdrawal = _ethPendingWithdrawal;
    totalEthPendingSubscription = _totalEthPendingSubscription;
    totalEthPendingWithdrawal = _totalEthPendingWithdrawal;

    LogSubscriptionCancellation(msg.sender);
    return true;
  }

  // Fulfill one subscription request
  // Delegates logic to the InvestorActions module
  function subscribe(address _addr)
    internal
    returns (bool success)
  {
    var (ethPendingSubscription, sharesOwned, shares, transferAmount, _totalSupply, _totalEthPendingSubscription) = investorActions.subscribe(_addr);
    investors[_addr].ethPendingSubscription = ethPendingSubscription;
    investors[_addr].sharesOwned = balances[_addr] = sharesOwned;
    totalSupply = _totalSupply;
    totalEthPendingSubscription = _totalEthPendingSubscription;

    exchange.transfer(transferAmount);
    LogSubscription(_addr, shares, navPerShare);
    return true;
  }
  function subscribeInvestor(address _addr)
    onlyOwner
    returns (bool success)
  {
    subscribe(_addr);
    return true;
  }

  // Fulfill all outstanding subsription requests
  // *Note re: gas - if there are too many investors (i.e. this process exceeds gas limits),
  //                 fallback is to subscribe() each individually
  function fillAllSubscriptionRequests()
    onlyOwner
    returns (bool allSubscriptionsFilled)
  {
    for (uint8 i = 0; i < investorAddresses.length; i++) {
      address addr = investorAddresses[i];
      if (investors[addr].ethPendingSubscription > 0) {
        subscribe(addr);
      }
    }
    return true;
  }

  // ********* REDEMPTIONS *********

  // Returns the total redemption requests not yet processed by the manager, denominated in ether
  function totalEthPendingRedemption()
    constant
    returns (uint)
  {
    return toEth(totalSharesPendingRedemption);
  }

  // [INVESTOR METHOD] Issue a redemption request
  // Delegates logic to the InvestorActions module
  function requestRedemption(uint _shares)
    whenNotPaused
    returns (bool success)
  {
    var (sharesPendingRedemption, _totalSharesPendingRedemption) = investorActions.requestRedemption(msg.sender, _shares);
    investors[msg.sender].sharesPendingRedemption = sharesPendingRedemption;
    totalSharesPendingRedemption = _totalSharesPendingRedemption;

    LogRedemptionRequest(msg.sender, _shares);
    return true;
  }

  // [INVESTOR METHOD] Cancels a redemption request
  // Delegates logic to the InvestorActions module
  function cancelRedemption()
    returns (bool success)
  {
    var (_sharesPendingRedemption, _totalSharesPendingRedemption) = investorActions.cancelRedemption(msg.sender);
    investors[msg.sender].sharesPendingRedemption = _sharesPendingRedemption;
    totalSharesPendingRedemption = _totalSharesPendingRedemption;

    LogRedemptionCancellation(msg.sender);
    return true;
  }

  // Fulfill one redemption request
  // Delegates logic to the InvestorActions module
  // Fulfill one sharesPendingRedemption request
  function redeem(address _addr)
    internal
    returns (bool success)
  {
    var (sharesOwned, sharesPendingRedemption, ethPendingWithdrawal, shares, _totalSupply, _totalSharesPendingRedemption, _totalEthPendingWithdrawal) = investorActions.redeem(_addr);
    investors[_addr].sharesOwned = balances[_addr] = sharesOwned;
    investors[_addr].sharesPendingRedemption = sharesPendingRedemption;
    investors[_addr].ethPendingWithdrawal = ethPendingWithdrawal;
    totalSupply = _totalSupply;
    totalSharesPendingRedemption = _totalSharesPendingRedemption;
    totalEthPendingWithdrawal = _totalEthPendingWithdrawal;

    LogRedemption(_addr, shares, navPerShare);
    return true;
  }
  function redeemInvestor(address _addr)
    onlyOwner
    returns (bool success)
  {
    redeem(_addr);
    return true;
  }

  // Fulfill all outstanding redemption requests
  // Delegates logic to the InvestorActions module
  // See note on gas/for loop in fillAllSubscriptionRequests
  function fillAllRedemptionRequests()
    onlyOwner
    returns (bool success)
  {
    require(totalEthPendingRedemption() <= this.balance.sub(totalEthPendingWithdrawal).sub(totalEthPendingSubscription));

    for (uint i = 0; i < investorAddresses.length; i++) {
      address addr = investorAddresses[i];
      if (investors[addr].sharesPendingRedemption > 0) {
        redeem(addr);
      }
    }
    return true;
  }

  // ********* LIQUIDATIONS *********

  // Converts all of an investor's shares to ether and makes it available for withdrawal.  Also makes the investor's allocation zero to prevent future investment.
  // Delegates logic to the InvestorActions module
  function liquidate(address _addr)
    internal
    returns (bool success)
  {
    var (ethPendingWithdrawal, shares, _totalEthPendingSubscription, _totalSharesPendingRedemption, _totalSupply, _totalEthPendingWithdrawal) = investorActions.liquidate(_addr);

    investors[_addr].ethTotalAllocation = 0;
    investors[_addr].ethPendingSubscription = 0;
    investors[_addr].sharesOwned = balances[_addr] = 0;
    investors[_addr].sharesPendingRedemption = 0;
    investors[_addr].ethPendingWithdrawal = ethPendingWithdrawal;
    totalEthPendingSubscription = _totalEthPendingSubscription;
    totalSharesPendingRedemption = _totalSharesPendingRedemption;
    totalSupply = _totalSupply;
    totalEthPendingWithdrawal = _totalEthPendingWithdrawal;

    LogLiquidation(_addr, shares, navPerShare);
    return true;
  }
  function liquidateInvestor(address _addr)
    onlyOwner
    returns (bool success)
  {
    liquidate(_addr);
    return true;
  }

  // Liquidates all investors
  // See note on gas/for loop in fillAllSubscriptionRequests
  function liquidateAllInvestors()
    onlyOwner
    returns (bool success)
  {
    for (uint8 i = 0; i < investorAddresses.length; i++) {
      address addr = investorAddresses[i];
      liquidate(addr);
    }
    return true;
  }

  // ********* WITHDRAWALS *********

  // Withdraw payment in the ethPendingWithdrawal balance
  // Delegates logic to the InvestorActions module
  function withdrawPayment()
    whenNotPaused
    returns (bool success)
  {
    var (payment, ethPendingWithdrawal, _totalEthPendingWithdrawal) = investorActions.withdraw(msg.sender);
    investors[msg.sender].ethPendingWithdrawal = ethPendingWithdrawal;
    totalEthPendingWithdrawal = _totalEthPendingWithdrawal;

    msg.sender.transfer(payment);

    LogWithdrawal(msg.sender, payment);
    return true;
  }

  // ********* NAV CALCULATION *********

  // Calculate and update NAV per share, lossCarryforward (the amount of losses that the fund to make up in order to start earning performance fees),
  // and accumulated management fee balaces.
  // Delegates logic to the NavCalculator module
  function calcNav()
    onlyOwner
    returns (bool success)
  {
    var (
      _lastCalcDate,
      _navPerShare,
      _lossCarryforward,
      _accumulatedMgmtFees,
      _accumulatedPerformFees
    ) = navCalculator.calculate();

    lastCalcDate = _lastCalcDate;
    navPerShare = _navPerShare;
    lossCarryforward = _lossCarryforward;
    accumulatedMgmtFees = _accumulatedMgmtFees;
    accumulatedPerformFees = _accumulatedPerformFees;

    LogNavSnapshot(lastCalcDate, navPerShare, lossCarryforward, accumulatedMgmtFees, accumulatedPerformFees);
    return true;
  }

  // ********* FEES *********

  function getTotalFees()
    constant
    returns (uint)
  {
    return accumulatedMgmtFees + accumulatedPerformFees;
  }

  // Withdraw management fees from the contract
  function withdrawFees()
    onlyOwner
    returns (bool success)
  {
    uint totalFees = accumulatedMgmtFees + accumulatedPerformFees;
    require(totalFees <= this.balance.sub(totalEthPendingWithdrawal).sub(totalEthPendingSubscription));

    address payee = msg.sender;
    uint ethPendingWithdrawal = totalFees;

    accumulatedMgmtFees = 0;
    accumulatedPerformFees = 0;
    payee.transfer(ethPendingWithdrawal);
    LogManagementFeeWithdrawal(totalFees);
    return true;
  }

  // ********* CONTRACT MAINTENANCE *********

  // Returns a list of all investor addresses
  function getInvestorAddresses()
    constant
    onlyOwner
    returns (address[])
  {
    return investorAddresses;
  }

  // Update the address of the exchange account
  function setExchange(address _exchange)
    onlyOwner
    returns (bool success)
  {
    address old = exchange;
    exchange = _exchange;
    LogExchangeAddressChanged(old, _exchange);
    return true;
  }

  // Update the address of the NAV Calculator module
  function setNavCalculator(address _addr)
    onlyOwner
    returns (bool success)
  {
    address old = navCalculator;
    navCalculator = NavCalculator(_addr);
    LogNavCalculatorModuleChanged(old, _addr);
    return true;
  }

  // Update the address of the Investor Actions module
  function setInvestorActions(address _addr)
    onlyOwner
    returns (bool success)
  {
    address old = investorActions;
    investorActions = InvestorActions(_addr);
    LogInvestorActionsModuleChanged(old, _addr);
    return true;
  }

  // Utility function for exchange to send funds to contract
  function remitFromExchange()
    payable
    onlyFromExchange
    returns (bool success)
  {
    LogTransferFromExchange(msg.value);
    return true;
  }

  // Utility function for contract to send funds to exchange
  function sendToExchange(uint amount)
    onlyOwner
    returns (bool success)
  {
    require(amount <= this.balance.sub(totalEthPendingSubscription).sub(totalEthPendingWithdrawal));
    exchange.transfer(amount);
    LogTransferToExchange(amount);
    return true;
  }

  // ********* HELPERS *********

  // Converts ether to a corresponding number of shares based on the current nav per share
  function toShares(uint _eth)
    constant
    returns (uint shares)
  {
    return _eth.mul(10000).div(navPerShare);
  }

  // Converts shares to a corresponding amount of ether based on the current nav per share
  function toEth(uint _shares)
    constant
    returns (uint ethAmount)
  {
    return _shares.mul(navPerShare).div(10000);
  }

  // ********* ERC20 METHODS *********
  // These ERC20 methods are based on the OpenZeppelin StandardToken library:
  // https://github.com/OpenZeppelin/zeppelin-solidity/blob/master/contracts/token/StandardToken.sol
  // They are have modified so that:
  // 1) transfer and transferFrom check that the recipient is eligible based on their allocation
  // 2) the sharesOwned variable in the Investor struct is identical to balances

  mapping(address => uint) balances;
  mapping (address => mapping (address => uint)) allowed;

  function transfer(address _to, uint _value)
    whenNotPaused
    returns (bool success)
  {
    require(_to != address(0));
    require(_value <= balances[msg.sender]);
    require(_value <= investors[msg.sender].sharesOwned);
    require(_value <= toShares(investorActions.getAvailableAllocation(_to)));
    investors[msg.sender].sharesOwned = investors[msg.sender].sharesOwned.sub(_value);
    balances[msg.sender] = balances[msg.sender].sub(_value);
    investors[_to].sharesOwned = investors[_to].sharesOwned.add(_value);
    balances[_to] = balances[_to].add(_value);
    Transfer(msg.sender, _to, _value);
    return true;
  }

  function transferFrom(address _from, address _to, uint _value)
    whenNotPaused
    returns (bool)
  {
    require(_to != address(0));
    require(_value <= allowed[_from][msg.sender]);
    require(_value <= balances[_from]);
    require(_value <= investors[_from].sharesOwned);
    require(_value <= toShares(investorActions.getAvailableAllocation(_to)));
    
    uint _allowance = allowed[_from][msg.sender];

    // Check is not needed because sub(_allowance, _value) will already throw if this condition is not met
    // require (_value <= _allowance);

    investors[_to].sharesOwned = investors[_to].sharesOwned.add(_value);
    balances[_to] = balances[_to].add(_value);
    investors[_from].sharesOwned = investors[_from].sharesOwned.sub(_value);
    balances[_from] = balances[_from].sub(_value);
    allowed[_from][msg.sender] = _allowance.sub(_value);
    Transfer(_from, _to, _value);
    return true;
  }

  function approve(address _spender, uint256 _value)
    whenNotPaused
    returns (bool success)
  {

    // To change the approve amount you first have to reduce the addresses`
    //  allowance to zero by calling `approve(_spender, 0)` if it is not
    //  already 0 to mitigate the race condition described here:
    //  https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
    require((_value == 0) || (allowed[msg.sender][_spender] == 0));

    allowed[msg.sender][_spender] = _value;
    Approval(msg.sender, _spender, _value);
    return true;
  }

  function balanceOf(address _owner)
    constant
    returns (uint256 balance)
  {
    return balances[_owner];
  }

  function allowance(address _owner, address _spender)
    constant
    returns (uint256 remaining)
  {
    return allowed[_owner][_spender];
  }

}
