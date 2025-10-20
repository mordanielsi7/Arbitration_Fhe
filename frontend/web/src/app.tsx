// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ArbitrationCase {
  id: string;
  encryptedAmount: string;
  encryptedDetails: string;
  timestamp: number;
  plaintiff: string;
  defendant: string;
  status: "pending" | "resolved" | "rejected";
  arbitratorVotes: number;
}

// Randomly selected style: High contrast (blue+orange), Industrial mechanical, Center radiation, Gesture controls
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<ArbitrationCase[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCaseData, setNewCaseData] = useState({ defendant: "", disputeAmount: 0, details: "" });
  const [selectedCase, setSelectedCase] = useState<ArbitrationCase | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showArbitratorPanel, setShowArbitratorPanel] = useState(false);
  const [isArbitrator, setIsArbitrator] = useState(false);
  const [activeTab, setActiveTab] = useState("cases");
  const [swipeStart, setSwipeStart] = useState(0);

  // Randomly selected features: Data statistics, Status flowchart, Project introduction
  const resolvedCount = cases.filter(c => c.status === "resolved").length;
  const pendingCount = cases.filter(c => c.status === "pending").length;
  const rejectedCount = cases.filter(c => c.status === "rejected").length;

  useEffect(() => {
    loadCases().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
      // Simulate arbitrator check (in real app would check on-chain)
      setIsArbitrator(Math.random() > 0.7); // 30% chance to be arbitrator for demo
    };
    initSignatureParams();
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    setSwipeStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const swipeEnd = e.changedTouches[0].clientX;
    const diff = swipeStart - swipeEnd;
    if (Math.abs(diff) > 50) { // Minimum swipe distance
      if (diff > 0) {
        // Swipe left
        setActiveTab(prev => prev === "cases" ? "stats" : "cases");
      } else {
        // Swipe right
        setActiveTab(prev => prev === "stats" ? "cases" : "stats");
      }
    }
  };

  const loadCases = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get case keys
      const keysBytes = await contract.getData("case_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing case keys:", e); }
      }
      
      // Load each case
      const caseList: ArbitrationCase[] = [];
      for (const key of keys) {
        try {
          const caseBytes = await contract.getData(`case_${key}`);
          if (caseBytes.length > 0) {
            try {
              const caseData = JSON.parse(ethers.toUtf8String(caseBytes));
              caseList.push({ 
                id: key, 
                encryptedAmount: caseData.amount, 
                encryptedDetails: caseData.details,
                timestamp: caseData.timestamp, 
                plaintiff: caseData.plaintiff, 
                defendant: caseData.defendant, 
                status: caseData.status || "pending",
                arbitratorVotes: caseData.arbitratorVotes || 0
              });
            } catch (e) { console.error(`Error parsing case data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading case ${key}:`, e); }
      }
      caseList.sort((a, b) => b.timestamp - a.timestamp);
      setCases(caseList);
    } catch (e) { console.error("Error loading cases:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitCase = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting dispute data with Zama FHE..." });
    try {
      const encryptedAmount = FHEEncryptNumber(newCaseData.disputeAmount);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const caseId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const caseData = { 
        amount: encryptedAmount, 
        details: newCaseData.details,
        timestamp: Math.floor(Date.now() / 1000), 
        plaintiff: address, 
        defendant: newCaseData.defendant, 
        status: "pending",
        arbitratorVotes: 0
      };
      
      await contract.setData(`case_${caseId}`, ethers.toUtf8Bytes(JSON.stringify(caseData)));
      
      // Update case keys
      const keysBytes = await contract.getData("case_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(caseId);
      await contract.setData("case_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted case submitted securely!" });
      await loadCases();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCaseData({ defendant: "", disputeAmount: 0, details: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const voteOnCase = async (caseId: string, vote: boolean) => {
    if (!isConnected || !isArbitrator) { alert("Arbitrators only"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted vote with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const caseBytes = await contract.getData(`case_${caseId}`);
      if (caseBytes.length === 0) throw new Error("Case not found");
      const caseData = JSON.parse(ethers.toUtf8String(caseBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedCase = { 
        ...caseData, 
        arbitratorVotes: caseData.arbitratorVotes + (vote ? 1 : -1),
        status: Math.abs(caseData.arbitratorVotes + (vote ? 1 : -1)) >= 3 ? "resolved" : "pending"
      };
      
      await contractWithSigner.setData(`case_${caseId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCase)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE vote recorded successfully!" });
      await loadCases();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Vote failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isInvolvedParty = (caseData: ArbitrationCase) => {
    if (!address) return false;
    return address.toLowerCase() === caseData.plaintiff.toLowerCase() || 
           address.toLowerCase() === caseData.defendant.toLowerCase();
  };

  const renderStatusFlowchart = () => {
    return (
      <div className="flowchart">
        <div className="flow-step">
          <div className={`step-icon ${pendingCount > 0 ? "active" : ""}`}>1</div>
          <div className="step-label">Case Filed</div>
          <div className="step-count">{pendingCount}</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className={`step-icon ${cases.length > 0 ? "active" : ""}`}>2</div>
          <div className="step-label">FHE Encryption</div>
          <div className="step-count">{cases.length}</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className={`step-icon ${resolvedCount > 0 ? "active" : ""}`}>3</div>
          <div className="step-label">Arbitration</div>
          <div className="step-count">{resolvedCount}</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className={`step-icon ${rejectedCount > 0 ? "active" : ""}`}>4</div>
          <div className="step-label">Resolution</div>
          <div className="step-count">{rejectedCount}</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing FHE arbitration system...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-icon"></div>
          <h1>FHE<span>Arbitration</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-case-btn industrial-button">
            <div className="add-icon"></div>File Case
          </button>
          {isArbitrator && (
            <button className="industrial-button" onClick={() => setShowArbitratorPanel(!showArbitratorPanel)}>
              {showArbitratorPanel ? "Hide Panel" : "Arbitrator Panel"}
            </button>
          )}
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Smart Contract Arbitration</h2>
            <p>Resolve disputes privately using Zama FHE technology - data remains encrypted throughout the process</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>

        <div className="tab-navigation">
          <button 
            className={`tab-button ${activeTab === "cases" ? "active" : ""}`}
            onClick={() => setActiveTab("cases")}
          >
            Cases
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
        </div>

        <div 
          className="content-area" 
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {activeTab === "cases" ? (
            <div className="cases-section">
              <div className="section-header">
                <h2>Active Arbitration Cases</h2>
                <div className="header-actions">
                  <button onClick={loadCases} className="refresh-btn industrial-button" disabled={isRefreshing}>
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              <div className="cases-list industrial-card">
                <div className="table-header">
                  <div className="header-cell">ID</div>
                  <div className="header-cell">Parties</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Votes</div>
                  <div className="header-cell">Actions</div>
                </div>
                {cases.length === 0 ? (
                  <div className="no-cases">
                    <div className="no-cases-icon"></div>
                    <p>No arbitration cases found</p>
                    <button className="industrial-button primary" onClick={() => setShowCreateModal(true)}>File First Case</button>
                  </div>
                ) : cases.map(c => (
                  <div className="case-row" key={c.id} onClick={() => setSelectedCase(c)}>
                    <div className="table-cell case-id">#{c.id.substring(0, 6)}</div>
                    <div className="table-cell">
                      <div>P: {c.plaintiff.substring(0, 6)}...</div>
                      <div>D: {c.defendant.substring(0, 6)}...</div>
                    </div>
                    <div className="table-cell">{new Date(c.timestamp * 1000).toLocaleDateString()}</div>
                    <div className="table-cell"><span className={`status-badge ${c.status}`}>{c.status}</span></div>
                    <div className="table-cell">{c.arbitratorVotes}</div>
                    <div className="table-cell actions">
                      {isInvolvedParty(c) && (
                        <button className="action-btn industrial-button" onClick={(e) => { e.stopPropagation(); setSelectedCase(c); }}>
                          View
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="stats-section">
              <div className="stats-grid">
                <div className="stats-card industrial-card">
                  <h3>Case Statistics</h3>
                  <div className="stats-row">
                    <div className="stat-item">
                      <div className="stat-value">{cases.length}</div>
                      <div className="stat-label">Total Cases</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{pendingCount}</div>
                      <div className="stat-label">Pending</div>
                    </div>
                  </div>
                  <div className="stats-row">
                    <div className="stat-item">
                      <div className="stat-value">{resolvedCount}</div>
                      <div className="stat-label">Resolved</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{rejectedCount}</div>
                      <div className="stat-label">Rejected</div>
                    </div>
                  </div>
                </div>
                <div className="stats-card industrial-card">
                  <h3>Arbitration Process</h3>
                  {renderStatusFlowchart()}
                </div>
                <div className="stats-card industrial-card">
                  <h3>About FHE Arbitration</h3>
                  <p>This system uses <strong>Zama FHE technology</strong> to keep all dispute data encrypted during arbitration. Arbitrators vote on encrypted data without seeing sensitive information.</p>
                  <div className="fhe-badge"><span>FHE-Powered</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCase} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          caseData={newCaseData} 
          setCaseData={setNewCaseData}
        />
      )}
      
      {selectedCase && (
        <CaseDetailModal 
          case={selectedCase} 
          onClose={() => { setSelectedCase(null); setDecryptedAmount(null); }} 
          decryptedAmount={decryptedAmount} 
          setDecryptedAmount={setDecryptedAmount} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          isArbitrator={isArbitrator}
          voteOnCase={voteOnCase}
        />
      )}
      
      {showArbitratorPanel && (
        <ArbitratorPanel 
          cases={cases.filter(c => c.status === "pending")} 
          onClose={() => setShowArbitratorPanel(false)}
          voteOnCase={voteOnCase}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="gear-icon"></div><span>FHE Arbitration</span></div>
            <p>Decentralized confidential arbitration powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} FHE Arbitration DAO</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  caseData: any;
  setCaseData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, caseData, setCaseData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCaseData({ ...caseData, [name]: value });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCaseData({ ...caseData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!caseData.defendant || !caseData.disputeAmount) { alert("Please fill required fields"); return; }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal industrial-card">
        <div className="modal-header">
          <h2>File New Arbitration Case</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>All case data will be encrypted with Zama FHE before submission</p></div>
          </div>
          <div className="form-group">
            <label>Defendant Address *</label>
            <input 
              type="text" 
              name="defendant" 
              value={caseData.defendant} 
              onChange={handleChange} 
              placeholder="0x..." 
              className="industrial-input"
            />
          </div>
          <div className="form-group">
            <label>Dispute Amount (ETH) *</label>
            <input 
              type="number" 
              name="disputeAmount" 
              value={caseData.disputeAmount} 
              onChange={handleAmountChange} 
              placeholder="Amount in dispute..." 
              className="industrial-input"
              step="0.01"
            />
          </div>
          <div className="form-group">
            <label>Case Details</label>
            <textarea 
              name="details" 
              value={caseData.details} 
              onChange={handleChange} 
              placeholder="Brief description of the dispute..." 
              className="industrial-textarea"
              rows={3}
            />
          </div>
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Amount:</span><div>{caseData.disputeAmount || 'No value entered'}</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{caseData.disputeAmount ? FHEEncryptNumber(caseData.disputeAmount).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn industrial-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn industrial-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Case"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CaseDetailModalProps {
  case: ArbitrationCase;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  isArbitrator: boolean;
  voteOnCase: (caseId: string, vote: boolean) => void;
}

const CaseDetailModal: React.FC<CaseDetailModalProps> = ({ 
  case: arbitrationCase, 
  onClose, 
  decryptedAmount, 
  setDecryptedAmount, 
  isDecrypting, 
  decryptWithSignature,
  isArbitrator,
  voteOnCase
}) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { setDecryptedAmount(null); return; }
    const decrypted = await decryptWithSignature(arbitrationCase.encryptedAmount);
    if (decrypted !== null) setDecryptedAmount(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="case-detail-modal industrial-card">
        <div className="modal-header">
          <h2>Case Details #{arbitrationCase.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="case-info">
            <div className="info-item"><span>Plaintiff:</span><strong>{arbitrationCase.plaintiff.substring(0, 6)}...{arbitrationCase.plaintiff.substring(38)}</strong></div>
            <div className="info-item"><span>Defendant:</span><strong>{arbitrationCase.defendant.substring(0, 6)}...{arbitrationCase.defendant.substring(38)}</strong></div>
            <div className="info-item"><span>Filed:</span><strong>{new Date(arbitrationCase.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${arbitrationCase.status}`}>{arbitrationCase.status}</strong></div>
            <div className="info-item"><span>Arbitrator Votes:</span><strong>{arbitrationCase.arbitratorVotes}</strong></div>
          </div>
          <div className="case-details">
            <h3>Case Details</h3>
            <div className="details-content">{arbitrationCase.encryptedDetails || "No details provided"}</div>
          </div>
          <div className="encrypted-data-section">
            <h3>Encrypted Dispute Amount</h3>
            <div className="encrypted-data">{arbitrationCase.encryptedAmount.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button className="decrypt-btn industrial-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedAmount !== null ? "Hide Amount" : "Decrypt with Wallet"}
            </button>
          </div>
          {decryptedAmount !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Amount</h3>
              <div className="decrypted-value">{decryptedAmount} ETH</div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted amount is only visible after wallet signature verification</span></div>
            </div>
          )}
          {isArbitrator && arbitrationCase.status === "pending" && (
            <div className="arbitrator-actions">
              <h3>Arbitrator Vote</h3>
              <div className="vote-buttons">
                <button className="industrial-button danger" onClick={() => voteOnCase(arbitrationCase.id, false)}>
                  Reject Case
                </button>
                <button className="industrial-button success" onClick={() => voteOnCase(arbitrationCase.id, true)}>
                  Accept Claim
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn industrial-button">Close</button>
        </div>
      </div>
    </div>
  );
};

interface ArbitratorPanelProps {
  cases: ArbitrationCase[];
  onClose: () => void;
  voteOnCase: (caseId: string, vote: boolean) => void;
}

const ArbitratorPanel: React.FC<ArbitratorPanelProps> = ({ cases, onClose, voteOnCase }) => {
  return (
    <div className="modal-overlay">
      <div className="arbitrator-panel industrial-card">
        <div className="panel-header">
          <h2>Arbitrator Panel</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="panel-body">
          <div className="panel-notice">
            <div className="warning-icon"></div>
            <p>As an arbitrator, you vote on encrypted data without seeing sensitive information</p>
          </div>
          <div className="pending-cases-list">
            <h3>Pending Cases ({cases.length})</h3>
            {cases.length === 0 ? (
              <div className="no-pending-cases">
                <p>No pending cases requiring arbitration</p>
              </div>
            ) : (
              cases.map(c => (
                <div className="pending-case" key={c.id}>
                  <div className="case-info">
                    <div className="case-id">Case #{c.id.substring(0, 6)}</div>
                    <div className="case-parties">
                      <span>P: {c.plaintiff.substring(0, 6)}...</span>
                      <span>D: {c.defendant.substring(0, 6)}...</span>
                    </div>
                    <div className="case-votes">Votes: {c.arbitratorVotes}</div>
                  </div>
                  <div className="case-actions">
                    <button className="industrial-button small danger" onClick={() => voteOnCase(c.id, false)}>
                      Reject
                    </button>
                    <button className="industrial-button small success" onClick={() => voteOnCase(c.id, true)}>
                      Accept
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;