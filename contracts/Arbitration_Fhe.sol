pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ArbitrationFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;
    bool public paused = false;

    struct Case {
        euint32 encryptedClaimAmount;
        euint32 encryptedEvidenceScore;
        euint32 encryptedDefendantResponseScore;
        bool exists;
    }

    struct Batch {
        uint256 caseCount;
        bool closed;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(uint256 => Case) public cases;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    uint256 public currentBatchId = 1;
    uint256 public nextCaseId = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsChanged(uint256 oldCooldown, uint256 newCooldown);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event CaseSubmitted(uint256 indexed caseId, uint256 indexed batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalClaimAmount, uint256 totalEvidenceScore, uint256 totalDefendantResponseScore, uint256 caseCount);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrFull();
    error CaseNotFound();
    error BatchNotFound();
    error InvalidBatchState();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsChanged(oldCooldown, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert InvalidBatchState();
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batches[currentBatchId].closed) {
            currentBatchId++;
        }
        if (batches[currentBatchId].caseCount > 0) {
            revert InvalidBatchState();
        }
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batches[currentBatchId].closed && batches[currentBatchId].caseCount > 0) {
            batches[currentBatchId].closed = true;
            emit BatchClosed(currentBatchId);
        } else {
            revert InvalidBatchState();
        }
    }

    function submitCase(
        euint32 encryptedClaimAmount,
        euint32 encryptedEvidenceScore,
        euint32 encryptedDefendantResponseScore
    ) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batches[currentBatchId].closed || batches[currentBatchId].caseCount >= 10) {
            revert BatchClosedOrFull();
        }

        lastSubmissionTime[msg.sender] = block.timestamp;

        uint256 caseId = nextCaseId++;
        cases[caseId] = Case({
            encryptedClaimAmount: encryptedClaimAmount,
            encryptedEvidenceScore: encryptedEvidenceScore,
            encryptedDefendantResponseScore: encryptedDefendantResponseScore,
            exists: true
        });
        batches[currentBatchId].caseCount++;

        emit CaseSubmitted(caseId, currentBatchId, msg.sender);
    }

    function requestBatchDecryption(uint256 batchId) external onlyOwner whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId == 0 || batchId >= currentBatchId || !batches[batchId].closed) {
            revert BatchNotFound();
        }

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        uint256 caseCount = batches[batchId].caseCount;
        if (caseCount == 0) {
            revert InvalidBatchState();
        }

        euint32 totalClaimAmount = FHE.asEuint32(0);
        euint32 totalEvidenceScore = FHE.asEuint32(0);
        euint32 totalDefendantResponseScore = FHE.asEuint32(0);

        for (uint256 i = 1; i <= caseCount; ) {
            uint256 caseId = batches[batchId].caseCount - i; // Example: sum last N cases
            if (!cases[caseId].exists) revert CaseNotFound();

            totalClaimAmount = totalClaimAmount.fheAdd(cases[caseId].encryptedClaimAmount);
            totalEvidenceScore = totalEvidenceScore.fheAdd(cases[caseId].encryptedEvidenceScore);
            totalDefendantResponseScore = totalDefendantResponseScore.fheAdd(cases[caseId].encryptedDefendantResponseScore);
            unchecked {
                i++;
            }
        }

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = totalClaimAmount.toBytes32();
        cts[1] = totalEvidenceScore.toBytes32();
        cts[2] = totalDefendantResponseScore.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) {
            revert ReplayAttempt();
        }

        uint256 batchId = decryptionContexts[requestId].batchId;
        uint256 caseCount = batches[batchId].caseCount;

        euint32 totalClaimAmount = FHE.asEuint32(0);
        euint32 totalEvidenceScore = FHE.asEuint32(0);
        euint32 totalDefendantResponseScore = FHE.asEuint32(0);

        for (uint256 i = 1; i <= caseCount; ) {
            uint256 caseId = batches[batchId].caseCount - i;
            if (!cases[caseId].exists) revert CaseNotFound();

            totalClaimAmount = totalClaimAmount.fheAdd(cases[caseId].encryptedClaimAmount);
            totalEvidenceScore = totalEvidenceScore.fheAdd(cases[caseId].encryptedEvidenceScore);
            totalDefendantResponseScore = totalDefendantResponseScore.fheAdd(cases[caseId].encryptedDefendantResponseScore);
            unchecked {
                i++;
            }
        }

        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = totalClaimAmount.toBytes32();
        currentCts[1] = totalEvidenceScore.toBytes32();
        currentCts[2] = totalDefendantResponseScore.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        try FHE.checkSignatures(requestId, cleartexts, proof) {
            uint256 totalClaimAmountCleartext = abi.decode(cleartexts, (uint256));
            uint256 totalEvidenceScoreCleartext = abi.decode(cleartexts[32:], (uint256));
            uint256 totalDefendantResponseScoreCleartext = abi.decode(cleartexts[64:], (uint256));

            decryptionContexts[requestId].processed = true;

            emit DecryptionCompleted(
                requestId,
                batchId,
                totalClaimAmountCleartext,
                totalEvidenceScoreCleartext,
                totalDefendantResponseScoreCleartext,
                caseCount
            );
        } catch {
            revert InvalidProof();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }
}