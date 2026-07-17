// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Initializable} from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import {Ownable2StepUpgradeable} from '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import {PausableUpgradeable} from '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import {ReentrancyGuardUpgradeable} from '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import {IGpcPriceOracle} from './interfaces/IGpcPriceOracle.sol';
import {IPancakeFactory} from './interfaces/IPancakeFactory.sol';
import {IPancakePair} from './interfaces/IPancakePair.sol';
import {IPancakeRouterV2} from './interfaces/IPancakeRouterV2.sol';

/**
 * @title GpcMiningCore
 * @notice Fixed 1,000 USDT orders, GPC mining rewards and 30-level community accounting.
 * @dev Production addresses are supplied by GpcMining. This core accepts addresses so it can be tested locally.
 */
abstract contract GpcMiningCore is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    uint256 public constant ORDER_USDT = 1_000 ether;
    uint256 public constant POWER_PER_ORDER = 2_000 ether;
    uint256 public constant PROMOTION_QUOTA_PER_ORDER = 1_000 ether;
    uint256 public constant DIRECT_REWARD = 200 ether;
    uint256 public constant OPERATION_SHARE = 50 ether;
    uint256 public constant USDT_TO_GPC = 700 ether;
    uint256 public constant USDT_TO_WBNB = 50 ether;

    uint256 public constant BPS = 10_000;
    uint256 public constant FIXED_DAILY_RATE_BPS = 25; // 0.25%
    uint256 public constant COMMUNITY_RATE_BPS = 500; // 5%
    uint256 public constant MAX_DAILY_RATE_BPS = 50; // 0.50%, static + community
    uint256 public constant WITHDRAW_FEE_BPS = 1_000; // 10%
    uint256 public constant MAX_WITHDRAW_POOL_BPS = 100; // 1%
    uint256 public constant MAX_GLOBAL_DAILY_WITHDRAW_POOL_BPS = 500; // 5% of window-opening pool
    uint256 public constant SWAP_SLIPPAGE_BPS = 200; // 2% TWAP floor
    uint256 public constant LP_SLIPPAGE_BPS = 200; // 2%
    uint256 public constant SPOT_TWAP_MAX_DEVIATION_BPS = 100; // 1%

    uint256 public constant ORDER_COOLDOWN = 1 minutes;
    uint256 public constant WITHDRAW_COOLDOWN = 24 hours;
    uint256 public constant INACTIVITY_PERIOD = 180 days;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;
    uint256 public constant MAX_REFERRAL_DEPTH = 30;
    uint256 public constant MAX_EXPIRE_BATCH = 50;

    struct UserInfo {
        uint256 power;
        uint256 totalPowerPurchased;
        uint256 promotionQuota;
        uint64 lastOrderAt;
        uint64 nextWithdrawAt;
        uint64 inactivityStartedAt;
    }

    struct RewardQuote {
        uint256 staticRewardUsdt;
        uint256 communityRewardUsdt;
        uint256 totalRewardUsdt;
        uint256 grossGpc;
        uint256 gpcPrice;
        uint256 poolValueUsdt;
        uint256 smallAreaPower;
        uint256 effectiveSmallAreaPower;
        bool poolLimitedMode;
    }

    IERC20 public usdt;
    IERC20 public gpc;
    IERC20 public wbnb;
    IPancakeRouterV2 public router;
    IGpcPriceOracle public oracle;
    IPancakePair public gpcWbnbPair;
    IPancakePair public wbnbUsdtPair;
    address public operationWallet;
    address public referralRoot;

    uint256 public totalPower;
    uint256 public miningPoolGpc;

    mapping(address => UserInfo) public users;
    mapping(address => address) public parentOf;
    mapping(address => uint8) public referralDepth;
    mapping(address => address[]) private _directReferrals;

    // Each direct child represents one complete referral branch below a leader.
    mapping(address => uint256) public teamPower;
    mapping(address => mapping(address => uint256)) public branchPower;

    // Per-leader max-heaps keep the largest branch query O(1), including after power burns.
    mapping(address => address[]) private _branchHeaps;
    mapping(address => mapping(address => uint256)) private _heapIndexPlusOne;

    uint256 public withdrawWindowStartedAt;
    uint256 public withdrawWindowPoolBase;
    uint256 public withdrawnGpcInWindow;

    // Reserved storage slots for future implementation upgrades.
    uint256[37] private __gap;

    event ReferralBound(address indexed user, address indexed parent, uint256 depth);
    event OrderPlaced(
        address indexed user,
        address indexed parent,
        address indexed directRewardRecipient,
        uint256 gpcBought,
        uint256 gpcAddedToPool,
        uint256 gpcAddedToLp,
        uint256 wbnbAddedToLp,
        uint256 liquidity
    );
    event Withdrawn(
        address indexed user,
        uint256 staticRewardUsdt,
        uint256 communityRewardUsdt,
        uint256 powerBurned,
        uint256 grossGpc,
        uint256 feeGpc,
        uint256 netGpc,
        uint256 gpcPrice
    );
    event PowerExpired(address indexed user, uint256 powerBurned, uint256 timestamp);
    event WbnbRemainderSentToOperation(uint256 amount);

    error ZeroAddress();
    error AlreadyBound();
    error ParentNotBound();
    error ReferralDepthExceeded();
    error RootCannotOrder();
    error ReferralRequired();
    error OrderCooldownActive();
    error InvalidDeadline();
    error UnsupportedUsdtTransfer();
    error OraclePriceInvalid();
    error PairNotFound();
    error InvalidPair();
    error EmptyPair();
    error SpotTwapDeviationTooHigh(address asset, uint256 spotPrice, uint256 twapPrice);
    error SwapOutputTooLow();
    error NoPower();
    error WithdrawCooldownActive();
    error NoReward();
    error WithdrawExceedsPoolLimit();
    error GlobalWithdrawLimitExceeded();
    error BatchTooLarge();
    error ProtectedToken();

    function __GpcMiningCore_init(
        address usdt_,
        address gpc_,
        address wbnb_,
        address router_,
        address oracle_,
        address operationWallet_,
        address governanceOwner_
    ) internal onlyInitializing {
        if (
            usdt_ == address(0) || gpc_ == address(0) || wbnb_ == address(0) ||
            router_ == address(0) || oracle_ == address(0) || operationWallet_ == address(0) ||
            governanceOwner_ == address(0)
        ) revert ZeroAddress();

        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        usdt = IERC20(usdt_);
        gpc = IERC20(gpc_);
        wbnb = IERC20(wbnb_);
        router = IPancakeRouterV2(router_);
        oracle = IGpcPriceOracle(oracle_);
        operationWallet = operationWallet_;
        referralRoot = operationWallet_;

        address factory = IPancakeRouterV2(router_).factory();
        address gpcPair = IPancakeFactory(factory).getPair(gpc_, wbnb_);
        address usdtPair = IPancakeFactory(factory).getPair(wbnb_, usdt_);
        if (gpcPair == address(0) || usdtPair == address(0)) revert PairNotFound();
        gpcWbnbPair = IPancakePair(gpcPair);
        wbnbUsdtPair = IPancakePair(usdtPair);
        _validatePair(IPancakePair(gpcPair), gpc_, wbnb_);
        _validatePair(IPancakePair(usdtPair), wbnb_, usdt_);

        parentOf[operationWallet_] = address(this);
        referralDepth[operationWallet_] = 0;

        IERC20(usdt_).safeApprove(router_, type(uint256).max);
        IERC20(gpc_).safeApprove(router_, type(uint256).max);
        IERC20(wbnb_).safeApprove(router_, type(uint256).max);

        _transferOwnership(governanceOwner_);
    }

    function bindReferral(address parent) external whenNotPaused {
        if (parent == address(0) || parent == msg.sender) revert ZeroAddress();
        if (parentOf[msg.sender] != address(0)) revert AlreadyBound();
        if (parentOf[parent] == address(0)) revert ParentNotBound();

        uint256 depth = uint256(referralDepth[parent]) + 1;
        if (depth > MAX_REFERRAL_DEPTH) revert ReferralDepthExceeded();

        parentOf[msg.sender] = parent;
        referralDepth[msg.sender] = uint8(depth);
        _directReferrals[parent].push(msg.sender);

        emit ReferralBound(msg.sender, parent, depth);
    }

    /**
     * @notice BscScan-friendly order entry using only on-chain TWAP and spot protections.
     */
    function placeOrder(uint256 deadline) external nonReentrant whenNotPaused {
        _placeOrder(deadline, 0, 0, 0, 0);
    }

    /**
     * @notice Places exactly one 1,000 USDT order.
     * @param deadline A caller-chosen expiry no more than five minutes in the future.
     * @param userMinGpcOut User-quoted GPC floor; zero keeps only the contract TWAP floor.
     * @param userMinWbnbOut User-quoted WBNB floor; zero keeps only the contract TWAP floor.
     * @param userMinLpGpc Minimum GPC accepted into LP.
     * @param userMinLpWbnb Minimum WBNB accepted into LP.
     */
    function placeOrder(
        uint256 deadline,
        uint256 userMinGpcOut,
        uint256 userMinWbnbOut,
        uint256 userMinLpGpc,
        uint256 userMinLpWbnb
    ) external nonReentrant whenNotPaused {
        _placeOrder(deadline, userMinGpcOut, userMinWbnbOut, userMinLpGpc, userMinLpWbnb);
    }

    function _placeOrder(
        uint256 deadline,
        uint256 userMinGpcOut,
        uint256 userMinWbnbOut,
        uint256 userMinLpGpc,
        uint256 userMinLpWbnb
    ) internal {
        if (msg.sender == referralRoot) revert RootCannotOrder();
        address parent = parentOf[msg.sender];
        if (parent == address(0) || parent == address(this)) revert ReferralRequired();
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert InvalidDeadline();
        }

        UserInfo storage user = users[msg.sender];
        if (user.lastOrderAt != 0 && block.timestamp < uint256(user.lastOrderAt) + ORDER_COOLDOWN) {
            revert OrderCooldownActive();
        }

        _expireIfNeeded(msg.sender);
        user.lastOrderAt = uint64(block.timestamp);

        uint256 beforeUsdt = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender, address(this), ORDER_USDT);
        if (usdt.balanceOf(address(this)) - beforeUsdt != ORDER_USDT) {
            revert UnsupportedUsdtTransfer();
        }

        address rewardRecipient = operationWallet;
        UserInfo storage parentInfo = users[parent];
        if (parentInfo.promotionQuota >= DIRECT_REWARD) {
            parentInfo.promotionQuota -= DIRECT_REWARD;
            rewardRecipient = parent;
        }
        usdt.safeTransfer(rewardRecipient, DIRECT_REWARD);
        usdt.safeTransfer(operationWallet, OPERATION_SHARE);

        (uint256 gpcBought, uint256 wbnbBought) = _executeProtectedSwaps(
            deadline,
            userMinGpcOut,
            userMinWbnbOut
        );
        uint256 desiredLpGpc = gpcBought / 14; // 5/70 of bought GPC
        uint256 poolGpc = gpcBought - desiredLpGpc;
        uint256 minLpGpc = Math.max(
            userMinLpGpc,
            Math.mulDiv(desiredLpGpc, BPS - LP_SLIPPAGE_BPS, BPS)
        );
        uint256 minLpWbnb = Math.max(
            userMinLpWbnb,
            Math.mulDiv(wbnbBought, BPS - LP_SLIPPAGE_BPS, BPS)
        );

        (uint256 usedGpc, uint256 usedWbnb, uint256 liquidity) = router.addLiquidity(
            address(gpc),
            address(wbnb),
            desiredLpGpc,
            wbnbBought,
            minLpGpc,
            minLpWbnb,
            operationWallet,
            deadline
        );

        // Any GPC not accepted by the pair becomes mining inventory. WBNB remainder goes to operations.
        poolGpc += desiredLpGpc - usedGpc;
        uint256 remainingWbnb = wbnbBought - usedWbnb;
        if (remainingWbnb != 0) {
            wbnb.safeTransfer(operationWallet, remainingWbnb);
            emit WbnbRemainderSentToOperation(remainingWbnb);
        }
        miningPoolGpc += poolGpc;

        _increasePower(msg.sender, POWER_PER_ORDER);
        user.totalPowerPurchased += POWER_PER_ORDER;
        user.promotionQuota += PROMOTION_QUOTA_PER_ORDER;
        user.nextWithdrawAt = uint64(block.timestamp + WITHDRAW_COOLDOWN);
        if (user.inactivityStartedAt == 0) {
            user.inactivityStartedAt = uint64(block.timestamp);
        }

        emit OrderPlaced(
            msg.sender,
            parent,
            rewardRecipient,
            gpcBought,
            poolGpc,
            usedGpc,
            usedWbnb,
            liquidity
        );
    }

    function withdraw() external nonReentrant whenNotPaused {
        if (_expireIfNeeded(msg.sender)) return;

        UserInfo storage user = users[msg.sender];
        if (user.power == 0) revert NoPower();
        if (block.timestamp < user.nextWithdrawAt) revert WithdrawCooldownActive();

        RewardQuote memory quote = _quoteRewards(msg.sender);
        if (quote.totalRewardUsdt == 0 || quote.grossGpc == 0) revert NoReward();
        _validateSpotAgainstTwap(quote.gpcPrice, oracle.bnbPrice());
        if (quote.grossGpc * BPS > miningPoolGpc * MAX_WITHDRAW_POOL_BPS) {
            revert WithdrawExceedsPoolLimit();
        }
        _consumeGlobalWithdrawCapacity(quote.grossGpc);

        uint256 feeGpc = Math.mulDiv(quote.grossGpc, WITHDRAW_FEE_BPS, BPS);
        uint256 netGpc = quote.grossGpc - feeGpc;

        user.nextWithdrawAt = uint64(block.timestamp + WITHDRAW_COOLDOWN);
        user.inactivityStartedAt = uint64(block.timestamp);
        _decreasePower(msg.sender, quote.totalRewardUsdt);
        miningPoolGpc -= quote.grossGpc;

        gpc.safeTransfer(msg.sender, netGpc);
        gpc.safeTransfer(operationWallet, feeGpc);

        emit Withdrawn(
            msg.sender,
            quote.staticRewardUsdt,
            quote.communityRewardUsdt,
            quote.totalRewardUsdt,
            quote.grossGpc,
            feeGpc,
            netGpc,
            quote.gpcPrice
        );
    }

    function expireUsers(address[] calldata accounts) external whenNotPaused {
        if (accounts.length > MAX_EXPIRE_BATCH) revert BatchTooLarge();
        for (uint256 i; i < accounts.length; ++i) {
            _expireIfNeeded(accounts[i]);
        }
    }

    function quoteRewards(address account) external view returns (RewardQuote memory) {
        if (_isExpired(account)) return RewardQuote(0, 0, 0, 0, 0, 0, 0, 0, false);
        return _quoteRewards(account);
    }

    function communityPower(address account)
        public
        view
        returns (uint256 total, uint256 largestBranchPower, uint256 smallArea, uint256 effectiveSmallArea)
    {
        total = teamPower[account];
        address[] storage heap = _branchHeaps[account];
        if (heap.length != 0) largestBranchPower = branchPower[account][heap[0]];
        smallArea = total - largestBranchPower;

        uint256 fiveTimesPersonal = users[account].power * 5;
        effectiveSmallArea = Math.min(smallArea, fiveTimesPersonal);
    }

    function directReferrals(address account) external view returns (address[] memory) {
        return _directReferrals[account];
    }

    function largestBranch(address account) external view returns (address branch, uint256 power) {
        address[] storage heap = _branchHeaps[account];
        if (heap.length != 0) {
            branch = heap[0];
            power = branchPower[account][branch];
        }
    }

    function isExpired(address account) external view returns (bool) {
        return _isExpired(account);
    }

    function spotPrices() public view returns (uint256 gpcUsdtPrice, uint256 wbnbUsdtPrice) {
        uint256 gpcWbnbPrice = _pairPrice(gpcWbnbPair, address(gpc), address(wbnb));
        wbnbUsdtPrice = _pairPrice(wbnbUsdtPair, address(wbnb), address(usdt));
        gpcUsdtPrice = Math.mulDiv(gpcWbnbPrice, wbnbUsdtPrice, 1 ether);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function rescueUnsupportedToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(usdt) || token == address(gpc) || token == address(wbnb)) {
            revert ProtectedToken();
        }
        IERC20(token).safeTransfer(to, amount);
    }

    function _consumeGlobalWithdrawCapacity(uint256 grossGpc) internal {
        if (
            withdrawWindowStartedAt == 0 ||
            block.timestamp >= withdrawWindowStartedAt + WITHDRAW_COOLDOWN
        ) {
            withdrawWindowStartedAt = block.timestamp;
            withdrawWindowPoolBase = miningPoolGpc;
            withdrawnGpcInWindow = 0;
        }

        uint256 windowLimit = Math.mulDiv(
            withdrawWindowPoolBase,
            MAX_GLOBAL_DAILY_WITHDRAW_POOL_BPS,
            BPS
        );
        if (withdrawnGpcInWindow + grossGpc > windowLimit) {
            revert GlobalWithdrawLimitExceeded();
        }
        withdrawnGpcInWindow += grossGpc;
    }

    function _executeProtectedSwaps(
        uint256 deadline,
        uint256 userMinGpcOut,
        uint256 userMinWbnbOut
    ) internal returns (uint256 gpcBought, uint256 wbnbBought) {
        uint256 gpcPrice = oracle.price();
        uint256 bnbPrice = oracle.bnbPrice();
        if (gpcPrice == 0 || bnbPrice == 0) revert OraclePriceInvalid();
        _validateSpotAgainstTwap(gpcPrice, bnbPrice);

        uint256 minGpc = Math.mulDiv(USDT_TO_GPC, 1 ether, gpcPrice);
        minGpc = Math.mulDiv(minGpc, BPS - SWAP_SLIPPAGE_BPS, BPS);
        minGpc = Math.max(minGpc, userMinGpcOut);
        uint256 minWbnb = Math.mulDiv(USDT_TO_WBNB, 1 ether, bnbPrice);
        minWbnb = Math.mulDiv(minWbnb, BPS - SWAP_SLIPPAGE_BPS, BPS);
        minWbnb = Math.max(minWbnb, userMinWbnbOut);

        address[] memory gpcPath = new address[](3);
        gpcPath[0] = address(usdt);
        gpcPath[1] = address(wbnb);
        gpcPath[2] = address(gpc);

        uint256 beforeGpc = gpc.balanceOf(address(this));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            USDT_TO_GPC,
            minGpc,
            gpcPath,
            address(this),
            deadline
        );
        gpcBought = gpc.balanceOf(address(this)) - beforeGpc;
        if (gpcBought < minGpc) revert SwapOutputTooLow();

        address[] memory wbnbPath = new address[](2);
        wbnbPath[0] = address(usdt);
        wbnbPath[1] = address(wbnb);

        uint256 beforeWbnb = wbnb.balanceOf(address(this));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            USDT_TO_WBNB,
            minWbnb,
            wbnbPath,
            address(this),
            deadline
        );
        wbnbBought = wbnb.balanceOf(address(this)) - beforeWbnb;
        if (wbnbBought < minWbnb) revert SwapOutputTooLow();
    }

    function _validateSpotAgainstTwap(uint256 gpcTwap, uint256 bnbTwap) internal view {
        (uint256 gpcSpot, uint256 bnbSpot) = spotPrices();
        if (!_withinDeviation(gpcSpot, gpcTwap, SPOT_TWAP_MAX_DEVIATION_BPS)) {
            revert SpotTwapDeviationTooHigh(address(gpc), gpcSpot, gpcTwap);
        }
        if (!_withinDeviation(bnbSpot, bnbTwap, SPOT_TWAP_MAX_DEVIATION_BPS)) {
            revert SpotTwapDeviationTooHigh(address(wbnb), bnbSpot, bnbTwap);
        }
    }

    function _withinDeviation(uint256 spot, uint256 twap, uint256 maxDeviationBps)
        internal
        pure
        returns (bool)
    {
        if (spot == 0 || twap == 0) return false;
        uint256 difference = spot > twap ? spot - twap : twap - spot;
        return Math.mulDiv(difference, BPS, twap) <= maxDeviationBps;
    }

    function _pairPrice(IPancakePair pair, address base, address quote) internal view returns (uint256) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        if (reserve0 == 0 || reserve1 == 0) revert EmptyPair();

        address token0 = pair.token0();
        address token1 = pair.token1();
        if (token0 == base && token1 == quote) {
            return Math.mulDiv(uint256(reserve1), 1 ether, uint256(reserve0));
        }
        if (token0 == quote && token1 == base) {
            return Math.mulDiv(uint256(reserve0), 1 ether, uint256(reserve1));
        }
        revert InvalidPair();
    }

    function _validatePair(IPancakePair pair, address tokenA, address tokenB) internal view {
        address token0 = pair.token0();
        address token1 = pair.token1();
        if (!((token0 == tokenA && token1 == tokenB) || (token0 == tokenB && token1 == tokenA))) {
            revert InvalidPair();
        }
    }

    function _quoteRewards(address account) internal view returns (RewardQuote memory quote) {
        uint256 personalPower = users[account].power;
        if (personalPower == 0 || totalPower == 0 || miningPoolGpc == 0) return quote;

        quote.gpcPrice = oracle.price();
        if (quote.gpcPrice == 0) revert OraclePriceInvalid();
        quote.poolValueUsdt = Math.mulDiv(miningPoolGpc, quote.gpcPrice, 1 ether);

        (, , quote.smallAreaPower, quote.effectiveSmallAreaPower) = communityPower(account);
        quote.poolLimitedMode = quote.poolValueUsdt * 20 < totalPower * 5;

        if (quote.poolLimitedMode) {
            quote.staticRewardUsdt = Math.mulDiv(quote.poolValueUsdt, personalPower, totalPower) / 100;
            quote.communityRewardUsdt = Math.mulDiv(
                Math.mulDiv(quote.poolValueUsdt, quote.effectiveSmallAreaPower, totalPower),
                COMMUNITY_RATE_BPS,
                BPS * 100
            );
        } else {
            quote.staticRewardUsdt = Math.mulDiv(personalPower, FIXED_DAILY_RATE_BPS, BPS);
            quote.communityRewardUsdt = Math.mulDiv(
                Math.mulDiv(quote.effectiveSmallAreaPower, FIXED_DAILY_RATE_BPS, BPS),
                COMMUNITY_RATE_BPS,
                BPS
            );
        }

        uint256 uncapped = quote.staticRewardUsdt + quote.communityRewardUsdt;
        uint256 dailyCap = Math.mulDiv(personalPower, MAX_DAILY_RATE_BPS, BPS);
        quote.totalRewardUsdt = Math.min(uncapped, dailyCap);

        // Preserve the static/community ratio if the combined 0.5% cap ever applies.
        if (quote.totalRewardUsdt < uncapped && uncapped != 0) {
            quote.staticRewardUsdt = Math.mulDiv(quote.staticRewardUsdt, quote.totalRewardUsdt, uncapped);
            quote.communityRewardUsdt = quote.totalRewardUsdt - quote.staticRewardUsdt;
        }
        quote.grossGpc = Math.mulDiv(quote.totalRewardUsdt, 1 ether, quote.gpcPrice);
    }

    function _increasePower(address account, uint256 amount) internal {
        users[account].power += amount;
        totalPower += amount;
        _updateAncestorBranches(account, amount, true);
    }

    function _decreasePower(address account, uint256 amount) internal {
        users[account].power -= amount;
        totalPower -= amount;
        _updateAncestorBranches(account, amount, false);
    }

    function _updateAncestorBranches(address account, uint256 amount, bool increase) internal {
        address branch = account;
        address ancestor = parentOf[account];

        for (uint256 level; level < MAX_REFERRAL_DEPTH; ++level) {
            if (ancestor == address(0) || ancestor == address(this)) break;

            uint256 oldBranchPower = branchPower[ancestor][branch];
            uint256 newBranchPower;
            if (increase) {
                newBranchPower = oldBranchPower + amount;
                teamPower[ancestor] += amount;
            } else {
                newBranchPower = oldBranchPower - amount;
                teamPower[ancestor] -= amount;
            }
            _setBranchPower(ancestor, branch, newBranchPower);

            branch = ancestor;
            ancestor = parentOf[ancestor];
        }
    }

    function _isExpired(address account) internal view returns (bool) {
        UserInfo storage user = users[account];
        return user.power != 0 && user.inactivityStartedAt != 0 &&
            block.timestamp >= uint256(user.inactivityStartedAt) + INACTIVITY_PERIOD;
    }

    function _expireIfNeeded(address account) internal returns (bool expired) {
        if (!_isExpired(account)) return false;

        UserInfo storage user = users[account];
        uint256 expiredPower = user.power;
        _decreasePower(account, expiredPower);
        user.nextWithdrawAt = 0;
        user.inactivityStartedAt = 0;

        emit PowerExpired(account, expiredPower, block.timestamp);
        return true;
    }

    function _setBranchPower(address leader, address branch, uint256 newPower) internal {
        uint256 indexPlusOne = _heapIndexPlusOne[leader][branch];
        branchPower[leader][branch] = newPower;

        if (indexPlusOne == 0) {
            if (newPower == 0) return;
            _branchHeaps[leader].push(branch);
            uint256 newIndex = _branchHeaps[leader].length - 1;
            _heapIndexPlusOne[leader][branch] = newIndex + 1;
            _siftUp(leader, newIndex);
            return;
        }

        uint256 index = indexPlusOne - 1;
        if (newPower == 0) {
            _removeHeapEntry(leader, index);
        } else {
            _rebalance(leader, index);
        }
    }

    function _removeHeapEntry(address leader, uint256 index) internal {
        address[] storage heap = _branchHeaps[leader];
        uint256 lastIndex = heap.length - 1;
        address removed = heap[index];

        if (index != lastIndex) {
            address moved = heap[lastIndex];
            heap[index] = moved;
            _heapIndexPlusOne[leader][moved] = index + 1;
        }
        heap.pop();
        delete _heapIndexPlusOne[leader][removed];

        if (index < heap.length) _rebalance(leader, index);
    }

    function _rebalance(address leader, uint256 index) internal {
        if (index != 0) {
            uint256 parentIndex = (index - 1) / 2;
            if (_higherPriority(leader, _branchHeaps[leader][index], _branchHeaps[leader][parentIndex])) {
                _siftUp(leader, index);
                return;
            }
        }
        _siftDown(leader, index);
    }

    function _siftUp(address leader, uint256 index) internal {
        address[] storage heap = _branchHeaps[leader];
        while (index != 0) {
            uint256 parentIndex = (index - 1) / 2;
            if (!_higherPriority(leader, heap[index], heap[parentIndex])) break;
            _swapHeapEntries(leader, index, parentIndex);
            index = parentIndex;
        }
    }

    function _siftDown(address leader, uint256 index) internal {
        address[] storage heap = _branchHeaps[leader];
        while (true) {
            uint256 left = index * 2 + 1;
            if (left >= heap.length) break;
            uint256 right = left + 1;
            uint256 best = left;
            if (right < heap.length && _higherPriority(leader, heap[right], heap[left])) best = right;
            if (!_higherPriority(leader, heap[best], heap[index])) break;
            _swapHeapEntries(leader, index, best);
            index = best;
        }
    }

    function _swapHeapEntries(address leader, uint256 a, uint256 b) internal {
        address[] storage heap = _branchHeaps[leader];
        address branchA = heap[a];
        address branchB = heap[b];
        heap[a] = branchB;
        heap[b] = branchA;
        _heapIndexPlusOne[leader][branchA] = b + 1;
        _heapIndexPlusOne[leader][branchB] = a + 1;
    }

    function _higherPriority(address leader, address a, address b) internal view returns (bool) {
        uint256 aPower = branchPower[leader][a];
        uint256 bPower = branchPower[leader][b];
        if (aPower != bPower) return aPower > bPower;
        return uint160(a) < uint160(b);
    }
}
