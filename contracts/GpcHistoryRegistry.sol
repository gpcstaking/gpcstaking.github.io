// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';

/**
 * @title GpcHistoryRegistry
 * @notice Stores the latest 30 power and promotion-quota changes per account.
 * @dev The mining proxy is set once as writer. Historical records can be
 *      migrated by the owner only before live records exist for an account.
 */
contract GpcHistoryRegistry is Ownable {
    uint8 public constant HISTORY_LIMIT = 30;
    uint8 public constant POWER_HISTORY_ORDER = 1;
    uint8 public constant POWER_HISTORY_WITHDRAW = 2;
    uint8 public constant POWER_HISTORY_EXPIRED = 3;
    uint8 public constant QUOTA_HISTORY_ORDER = 1;
    uint8 public constant QUOTA_HISTORY_REFERRAL = 2;

    struct HistoryRecord {
        uint256 amount;
        uint64 timestamp;
        uint8 kind;
    }

    struct HistorySeed {
        uint192 amount;
        uint64 timestamp;
        uint8 kind;
    }

    struct HistoryMeta {
        uint8 powerNext;
        uint8 powerCount;
        uint8 quotaNext;
        uint8 quotaCount;
    }

    address public writer;
    uint64 public immutable trackingStartedAt;

    mapping(address => HistoryMeta) private _historyMeta;
    mapping(address => mapping(uint8 => uint256)) private _powerHistoryRecords;
    mapping(address => mapping(uint8 => uint256)) private _quotaHistoryRecords;
    mapping(address => bool) public historyMigrated;

    event WriterSet(address indexed writer);
    event HistoryMigrated(address indexed account, uint256 powerRecords, uint256 quotaRecords);

    error ZeroAddress();
    error WriterAlreadySet();
    error UnauthorizedWriter();
    error HistoryAlreadyMigrated();
    error HistoryAlreadyStarted();
    error InvalidHistoryTimestamp();
    error InvalidHistoryKind();
    error HistoryAmountOverflow();
    error TooManyHistoryRecords();

    constructor() {
        trackingStartedAt = uint64(block.timestamp);
    }

    modifier onlyWriter() {
        if (msg.sender != writer) revert UnauthorizedWriter();
        _;
    }

    function setWriter(address writer_) external onlyOwner {
        if (writer_ == address(0)) revert ZeroAddress();
        if (writer != address(0)) revert WriterAlreadySet();
        writer = writer_;
        emit WriterSet(writer_);
    }

    function appendPower(address account, uint256 amount, uint8 kind) external onlyWriter {
        _validatePowerHistoryKind(kind);
        _appendPowerHistoryAt(account, amount, uint64(block.timestamp), kind);
    }

    function appendQuota(address account, uint256 amount, uint8 kind) external onlyWriter {
        _validateQuotaHistoryKind(kind);
        _appendQuotaHistoryAt(account, amount, uint64(block.timestamp), kind);
    }

    function migrateHistories(
        address account,
        HistorySeed[] calldata powerRecords,
        HistorySeed[] calldata quotaRecords
    ) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (powerRecords.length > HISTORY_LIMIT || quotaRecords.length > HISTORY_LIMIT) {
            revert TooManyHistoryRecords();
        }
        if (historyMigrated[account]) revert HistoryAlreadyMigrated();
        HistoryMeta storage meta = _historyMeta[account];
        if (meta.powerCount != 0 || meta.quotaCount != 0) revert HistoryAlreadyStarted();

        for (uint256 i; i < powerRecords.length; ++i) {
            HistorySeed calldata record = powerRecords[i];
            if (record.timestamp >= trackingStartedAt) revert InvalidHistoryTimestamp();
            _validatePowerHistoryKind(record.kind);
            _appendPowerHistoryAt(account, record.amount, record.timestamp, record.kind);
        }
        for (uint256 i; i < quotaRecords.length; ++i) {
            HistorySeed calldata record = quotaRecords[i];
            if (record.timestamp >= trackingStartedAt) revert InvalidHistoryTimestamp();
            _validateQuotaHistoryKind(record.kind);
            _appendQuotaHistoryAt(account, record.amount, record.timestamp, record.kind);
        }

        historyMigrated[account] = true;
        emit HistoryMigrated(account, powerRecords.length, quotaRecords.length);
    }

    function powerHistory(address account, uint256 offset, uint256 limit)
        external
        view
        returns (HistoryRecord[] memory records, uint256 total)
    {
        return _readHistory(account, offset, limit, true);
    }

    function promotionQuotaHistory(address account, uint256 offset, uint256 limit)
        external
        view
        returns (HistoryRecord[] memory records, uint256 total)
    {
        return _readHistory(account, offset, limit, false);
    }

    function _appendPowerHistoryAt(address account, uint256 amount, uint64 timestamp, uint8 kind) internal {
        HistoryMeta storage meta = _historyMeta[account];
        _powerHistoryRecords[account][meta.powerNext] = _packHistoryRecord(amount, timestamp, kind);
        meta.powerNext = uint8((uint256(meta.powerNext) + 1) % HISTORY_LIMIT);
        if (meta.powerCount < HISTORY_LIMIT) meta.powerCount += 1;
    }

    function _appendQuotaHistoryAt(address account, uint256 amount, uint64 timestamp, uint8 kind) internal {
        HistoryMeta storage meta = _historyMeta[account];
        _quotaHistoryRecords[account][meta.quotaNext] = _packHistoryRecord(amount, timestamp, kind);
        meta.quotaNext = uint8((uint256(meta.quotaNext) + 1) % HISTORY_LIMIT);
        if (meta.quotaCount < HISTORY_LIMIT) meta.quotaCount += 1;
    }

    function _packHistoryRecord(uint256 amount, uint64 timestamp, uint8 kind) internal pure returns (uint256) {
        if (amount > type(uint192).max) revert HistoryAmountOverflow();
        if (timestamp > type(uint40).max) revert InvalidHistoryTimestamp();
        return amount | (uint256(timestamp) << 192) | (uint256(kind) << 232);
    }

    function _readHistory(address account, uint256 offset, uint256 limit, bool power)
        internal
        view
        returns (HistoryRecord[] memory records, uint256 total)
    {
        HistoryMeta memory meta = _historyMeta[account];
        total = power ? uint256(meta.powerCount) : uint256(meta.quotaCount);
        if (offset >= total || limit == 0) return (new HistoryRecord[](0), total);

        uint256 length = Math.min(limit, total - offset);
        records = new HistoryRecord[](length);
        uint256 next = power ? uint256(meta.powerNext) : uint256(meta.quotaNext);
        for (uint256 i; i < length; ++i) {
            uint8 index = uint8((next + HISTORY_LIMIT - 1 - offset - i) % HISTORY_LIMIT);
            uint256 packed = power
                ? _powerHistoryRecords[account][index]
                : _quotaHistoryRecords[account][index];
            records[i] = HistoryRecord({
                amount: uint192(packed),
                timestamp: uint64(uint40(packed >> 192)),
                kind: uint8(packed >> 232)
            });
        }
    }

    function _validatePowerHistoryKind(uint8 kind) internal pure {
        if (kind < POWER_HISTORY_ORDER || kind > POWER_HISTORY_EXPIRED) revert InvalidHistoryKind();
    }

    function _validateQuotaHistoryKind(uint8 kind) internal pure {
        if (kind < QUOTA_HISTORY_ORDER || kind > QUOTA_HISTORY_REFERRAL) revert InvalidHistoryKind();
    }
}
