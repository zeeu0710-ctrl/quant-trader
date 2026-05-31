import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot 
} from 'firebase/firestore';

// ============================================================================
// FIREBASE CONFIG & INITIALIZATION (SECURE & SANDBOXED)
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "",
      authDomain: "default-app-id.firebaseapp.com",
      projectId: "default-app-id",
      storageBucket: "default-app-id.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abcdef"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'quanttrader-pro';
const googleProvider = new GoogleAuthProvider();

export default function App() {
  // ============================================================================
  // APP STATES
  // ============================================================================
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('planner'); // planner, journal, performance, settings, adminPortal
  const [toast, setToast] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLocalMode, setIsLocalMode] = useState(false);

  // Authentication Modals & UI States
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Custom UI Modals (Replaces native blocking alerts/confirm)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmMigrationData, setConfirmMigrationData] = useState(null);

  // Role Elevation Gateway state
  const [showAdminKeyModal, setShowAdminKeyModal] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState('');

  // Private Member Account Configuration (Private Sandbox space)
  const [memberConfig, setMemberConfig] = useState({
    nickname: '頂級交易員',
    defaultRiskCapital: 10000,
    baseCurrency: 'USDT',
    role: 'member' // Default role
  });

  // Global Settings State (Admin editable, General users read-only, synced globally)
  const [globalSettings, setGlobalSettings] = useState({
    makerFee: 0.02, // %
    takerFee: 0.05, // %
    coins: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'BNB', 'ORDI', 'PEPE'],
    timeframes: ['15分鐘', '1小時', '4小時', '1日'],
    strategies: ['Fibo+趨勢線', '均線金叉', 'SMC 訂單塊回測', '流動性掃蕩', '突破追單', '套保對沖']
  });

  // Temp state to allow edits in admin tab before saving/publishing
  const [editingGlobal, setEditingGlobal] = useState({ ...globalSettings });
  const [newCoinInput, setNewCoinInput] = useState('');
  const [newStrategyInput, setNewStrategyInput] = useState('');

  // All Users Directory (For Admin/Owner inspection & Role assignments)
  const [usersDirectory, setUsersDirectory] = useState([]);
  
  // The User UID currently active in the workspace panels (Admin can pivot this to monitor others)
  const [viewingUid, setViewingUid] = useState(null);
  const [inspectedMemberConfig, setInspectedMemberConfig] = useState(null);

  // ============================================================================
  // RBAC RESOLVERS (ROLE-BASED ACCESS CONTROL)
  // ============================================================================
  const currentUserRole = useMemo(() => {
    if (!user) return 'member';
    if (user.email === 'admin@quanttrader.pro') return 'owner';
    const liveProfile = usersDirectory.find(u => u.uid === user.uid);
    return liveProfile?.role || memberConfig.role || 'member';
  }, [user, usersDirectory, memberConfig.role]);

  const isOwner = currentUserRole === 'owner';
  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'owner';
  const isViewer = currentUserRole === 'viewer';
  
  const isStaff = useMemo(() => {
    return isOwner || isAdmin || isViewer;
  }, [isOwner, isAdmin, isViewer]);

  // Is current view panel locked in "Inspecting someone else" mode?
  const isInspecting = useMemo(() => {
    return user && viewingUid && viewingUid !== user.uid;
  }, [user, viewingUid]);

  // Trading Journal State (Integrates "hedged" logic & Mistake Analysis)
  const [records, setRecords] = useState([
    {
      id: 'init-1',
      date: '2026-05-27',
      time: '07:50',
      coin: 'BTC',
      timeframe: '1小時',
      direction: '空',
      strategy: 'Fibo+趨勢線',
      tpReached: '是',
      slHit: '否',
      hedged: '否',
      riskCoeff: '1.0',
      confidence: 8,
      expectedR: 7.26,
      actualR: 7.26,
      plannedPnL: 726.00,
      actualPnL: 726.00,
      winLoss: '✅ 勝',
      reason: 'Fibo0.5趨勢線未能突破3+1平倉80% 放飛20%',
      chartData: '',
      perfChartData: '',
      mistakeTag: '無犯錯 (嚴格執行計畫) ✅'
    },
    {
      id: 'init-2',
      date: '2026-05-26',
      time: '14:20',
      coin: 'ETH',
      timeframe: '4小時',
      direction: '多',
      strategy: '均線金叉',
      tpReached: '是',
      slHit: '否',
      hedged: '否',
      riskCoeff: '1.0',
      confidence: 7,
      expectedR: 3.50,
      actualR: 3.10,
      plannedPnL: 350.00,
      actualPnL: 310.00,
      winLoss: '✅ 勝',
      reason: '4H EMA20 支撐確認，TP1部分止盈，後續回踩保本出場',
      chartData: '',
      perfChartData: '',
      mistakeTag: '提前手動止盈 (抗壓不足) 🏃'
    }
  ]);

  // Trade Planner State (Timeframe custom list + SL Renaming + Risk Auto-sizing)
  const [planner, setPlanner] = useState({
    coin: 'BTC',
    timeframe: '1小時',
    direction: '多', 
    entryPrice: 68000,
    orderValue: 10000, 
    stopLossPrice: 67000,
    strategy: 'SMC 訂單塊回測',
    confidence: 8,
    riskCoeff: 1.0,
    reason: '',
    screenshot: '',
    hedged: '否', 
    mistakeTag: '無犯錯 (嚴格執行計畫) ✅',
    useSmartSizing: false, // Smart Sizing toggle
    riskAmount: 100, // Capital at risk per trade (R)
    leverageSizing: 20, // Slider for margin estimation
    tps: [
      { id: 1, price: 70000, percent: 50, active: true },
      { id: 2, price: 72000, percent: 30, active: true },
      { id: 3, price: 75000, percent: 20, active: true },
      { id: 4, price: 0, percent: 0, active: false }
    ]
  });

  const [screenshotPreview, setScreenshotPreview] = useState('');
  const fileInputRef = useRef(null);
  const csvImportRef = useRef(null);

  // ============================================================================
  // FIREBASE SECURITY & CONSTRAINTS COMPLIANT AUTHENTICATION
  // ============================================================================
  useEffect(() => {
    let unsubscribe = () => {};
    const initAuth = async () => {
      try {
        setIsSyncing(true);
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase Auth Error: ", err);
        showToast("伺服器連線失敗，自動啟用離線本機保存模式", "warning");
        setIsLocalMode(true);
        setIsSyncing(false);
      }
    };
    
    initAuth();
    
    unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setViewingUid(currentUser.uid); 
        setIsLocalMode(false);
        registerUserInDirectory(currentUser.uid, currentUser.email, memberConfig.nickname, memberConfig.role);
      } else {
        setUser(null);
        setViewingUid(null);
      }
      setIsSyncing(false);
    });

    return () => unsubscribe();
  }, []);

  // Helper: Write user index into public directory
  const registerUserInDirectory = async (uid, email, nickname, assignedRole = 'member') => {
    if (!uid || isLocalMode) return;
    try {
      const dirRef = doc(db, 'artifacts', appId, 'public', 'data', 'users_directory', uid);
      const snap = await getDoc(dirRef);
      let roleToSave = assignedRole;
      if (snap.exists() && snap.data().role) {
        roleToSave = snap.data().role;
      }
      await setDoc(dirRef, {
        uid,
        email: email || '匿名訪客',
        nickname: nickname || '頂級交易員',
        role: roleToSave,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn("Public directory registration failed:", err);
    }
  };

  // ============================================================================
  // DATABASE SYNCING (RULE 1 & RULE 2 COMPLIANT)
  // ============================================================================
  
  // A. Sync Global Settings (Read by everyone, written by Owners & Admins only)
  useEffect(() => {
    if (!user || isLocalMode) return;

    const globalSettingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_settings', 'global');
    
    const unsubGlobal = onSnapshot(globalSettingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGlobalSettings(data);
        setEditingGlobal(data); 
      } else {
        if (user.email === 'admin@quanttrader.pro' || currentUserRole === 'owner') {
          setDoc(globalSettingsRef, globalSettings);
        }
      }
    }, (error) => {
      console.warn("Public global config fetch blocked or uninitialized. Using local parameters.", error);
    });

    return () => unsubGlobal();
  }, [user, isLocalMode, currentUserRole]);

  // B. Sync Private User Configuration and Journal (Dynamic Viewing Target)
  useEffect(() => {
    if (!user || !viewingUid || isLocalMode) return;

    const privateUserConfigRef = doc(db, 'artifacts', appId, 'users', viewingUid, 'trading_config', 'main');
    
    setIsSyncing(true);
    const unsubPrivate = onSnapshot(privateUserConfigRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.records) setRecords(data.records);
        
        if (data.memberConfig) {
          if (viewingUid === user.uid) {
            setMemberConfig(prev => ({ ...prev, ...data.memberConfig }));
          } else {
            setInspectedMemberConfig(data.memberConfig);
          }
        }
      } else {
        if (viewingUid !== user.uid) {
          setRecords([]);
          setInspectedMemberConfig({ nickname: '全新交易員', defaultRiskCapital: 10000, baseCurrency: 'USDT', role: 'member' });
        }
      }
      setIsSyncing(false);
    }, (error) => {
      console.error("Private user config sync error:", error);
      setIsSyncing(false);
    });

    return () => unsubPrivate();
  }, [user, viewingUid, isLocalMode]);

  // C. Sync Public Users Directory list (Only for verified Admins/Owners/Viewers)
  useEffect(() => {
    if (!isStaff || isLocalMode) {
      setUsersDirectory([]);
      return;
    }

    const dirColRef = collection(db, 'artifacts', appId, 'public', 'data', 'users_directory');
    const unsubDir = onSnapshot(dirColRef, (snapshot) => {
      const users = [];
      snapshot.forEach(docSnap => {
        users.push(docSnap.data());
      });
      setUsersDirectory(users);
    }, (error) => {
      console.warn("Failed to subscribe to public users directory:", error);
    });

    return () => unsubDir();
  }, [isStaff, isLocalMode]);

  // Save private member configuration and logs to user space
  const savePrivateData = async (newRecords, newMemberConfig = null) => {
    if (isInspecting) {
      showToast("安全防線：監看狀態下禁止篡改學員實時數據！", "error");
      return;
    }

    if (!user || isLocalMode) {
      localStorage.setItem('quant_records', JSON.stringify(newRecords));
      if (newMemberConfig) localStorage.setItem('quant_member_config', JSON.stringify(newMemberConfig));
      return;
    }
    
    setIsSyncing(true);
    try {
      const privateUserConfigRef = doc(db, 'artifacts', appId, 'users', user.uid, 'trading_config', 'main');
      const targetConfig = newMemberConfig || memberConfig;
      
      await setDoc(privateUserConfigRef, {
        records: newRecords,
        memberConfig: targetConfig,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      registerUserInDirectory(user.uid, user.email, targetConfig.nickname, targetConfig.role);
    } catch (err) {
      console.error("Failed to save private data to cloud:", err);
      showToast("雲端備份失敗，已先將數據記錄於本地快取", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // D. Admin Action: Save Public Global Configuration
  const saveGlobalSettingsDoc = async (targetGlobalSettings) => {
    if (isViewer) {
      showToast("權限不足：檢視員不具備修改全域配置之權限！", "error");
      return;
    }
    if (!isAdmin) {
      showToast("權限不足：一般會員不具備系統管理員權限！", "error");
      return;
    }
    if (isLocalMode) {
      setGlobalSettings(targetGlobalSettings);
      showToast("本機模式已完成參數調整", "success");
      return;
    }

    setIsSyncing(true);
    try {
      const globalSettingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'system_settings', 'global');
      await setDoc(globalSettingsRef, targetGlobalSettings);
      showToast("💎 全域系統配置發佈成功！所有會員已即時同步", "success");
    } catch (err) {
      console.error("Failed to post global settings:", err);
      showToast("發佈全域參數失敗，請檢查權限", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // E. Owner Action: Modify user roles inside the registered public directory
  const changeUserRoleInCloud = async (targetUid, nextRole) => {
    if (!isOwner) {
      showToast("安全防禦：非擁有者(Owner)無法異動其他成員的權限角色！", "error");
      return;
    }
    try {
      const userDirRef = doc(db, 'artifacts', appId, 'public', 'data', 'users_directory', targetUid);
      await setDoc(userDirRef, { role: nextRole }, { merge: true });
      
      const targetPrivateConfigRef = doc(db, 'artifacts', appId, 'users', targetUid, 'trading_config', 'main');
      await setDoc(targetPrivateConfigRef, {
        memberConfig: { role: nextRole }
      }, { merge: true });

      showToast(`變更成功！學員帳戶已被指派為: ${nextRole.toUpperCase()}`, "success");
    } catch (err) {
      console.error("Role update failed:", err);
      showToast("變更角色失敗，請檢查資料庫規則", "error");
    }
  };

  // Load from LocalStorage if offline/local
  useEffect(() => {
    if (isLocalMode) {
      const localRecs = localStorage.getItem('quant_records');
      const localMemberConfig = localStorage.getItem('quant_member_config');
      if (localRecs) setRecords(JSON.parse(localRecs));
      if (localMemberConfig) setMemberConfig(JSON.parse(localMemberConfig));
    }
  }, [isLocalMode]);

  // ============================================================================
  // ADVANCED AUTHENTICATION FLOWS (EMAIL VERIFICATION & GOOGLE AUTH)
  // ============================================================================
  const handleEmailRegister = async (e) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      showToast("請填寫完整的信箱與密碼！", "warning");
      return;
    }
    setAuthLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      await sendEmailVerification(userCredential.user);
      
      showToast("註冊成功！驗證信件已寄出，請查收您的收件匣", "success");
      setAuthMode('login');
      if (records.length > 2) {
        setConfirmMigrationData(records);
      }
    } catch (error) {
      console.error("Registration failed:", error);
      showToast(`註冊失敗: ${error.message}`, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      showToast("請輸入密碼與電子信箱！", "warning");
      return;
    }
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      showToast("帳號登入成功！數據已完成同步", "success");
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (error) {
      console.error("Login failed:", error);
      showToast(`登入失敗: ${error.message}`, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      
      setMemberConfig(prev => {
        const nextNickname = prev.nickname === '頂級交易員' && result.user.displayName 
          ? result.user.displayName 
          : prev.nickname;
        return { ...prev, nickname: nextNickname };
      });

      showToast(`歡迎回來, ${result.user.displayName || '交易員'}！`, "success");
      setShowAuthModal(false);
      
      if (records.length > 2) {
        setConfirmMigrationData(records);
      }
    } catch (error) {
      console.error("Google authentication failed:", error);
      showToast("Google 認證失敗，若處於沙盒內請使用信箱登入", "warning");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!user) return;
    try {
      await sendEmailVerification(user);
      showToast("驗證郵件重發成功，請確認垃圾信件匣", "success");
    } catch (err) {
      showToast("發送頻率過快，請稍候再試", "error");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setMemberConfig({
        nickname: '頂級交易員',
        defaultRiskCapital: 10000,
        baseCurrency: 'USDT',
        role: 'member'
      });
      setInspectedMemberConfig(null);
      setSessionIsAdmin(false);
      await signInAnonymously(auth);
      showToast("已安全登出帳號，返回訪客模式", "info");
    } catch (err) {
      showToast("登出失敗", "error");
    }
  };

  const executeDataMigration = async () => {
    if (!user || !confirmMigrationData) return;
    try {
      await savePrivateData(confirmMigrationData);
      showToast("歷史交易日誌已成功遷移至您的雲端帳戶！", "success");
    } catch (err) {
      showToast("轉移失敗", "error");
    } finally {
      setConfirmMigrationData(null);
    }
  };

  // ============================================================================
  // ADMIN & OWNER PASSCODE ELEVATION
  // ============================================================================
  const verifyAdminKey = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    let nextRole = 'member';
    if (adminKeyInput === 'QUANT_OWNER_2026') {
      nextRole = 'owner';
    } else if (adminKeyInput === 'QUANT_ADMIN_2026') {
      nextRole = 'admin';
    } else if (adminKeyInput === 'QUANT_VIEWER_2026') {
      nextRole = 'viewer';
    }

    if (nextRole !== 'member') {
      try {
        setMemberConfig(prev => ({ ...prev, role: nextRole }));
        
        const privateUserConfigRef = doc(db, 'artifacts', appId, 'users', user.uid, 'trading_config', 'main');
        await setDoc(privateUserConfigRef, {
          memberConfig: { role: nextRole }
        }, { merge: true });

        const dirRef = doc(db, 'artifacts', appId, 'public', 'data', 'users_directory', user.uid);
        await setDoc(dirRef, { role: nextRole }, { merge: true });

        showToast(`💎 身份解鎖成功！您已獲得全域 [ ${nextRole.toUpperCase()} ] 權限`, "success");
        setShowAdminKeyModal(false);
        setAdminKeyInput('');
      } catch (err) {
        showToast("權限寫入資料庫失敗，請確認雲端連接狀態", "error");
      }
    } else {
      showToast("密鑰錯誤！請確認拼寫與大小寫是否吻合系統公鑰", "error");
    }
  };

  // ============================================================================
  // UTILITY ACTIONS
  // ============================================================================
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const copyUidToClipboard = (textToCopy) => {
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = textToCopy;
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    try {
      document.execCommand('copy');
      showToast("UID 已安全複製至剪貼簿", "success");
    } catch (err) {
      showToast("複製失敗，請手動複製", "error");
    }
    document.body.removeChild(tempTextArea);
  };

  // Dynamically resolve active member configuration (swaps to guest when inspecting)
  const activeMemberConfig = useMemo(() => {
    if (isInspecting && inspectedMemberConfig) {
      return inspectedMemberConfig;
    }
    return memberConfig;
  }, [isInspecting, inspectedMemberConfig, memberConfig]);

  // ============================================================================
  // PROFESSIONAL MISTAKE LOGGER DEFINITIONS
  // ============================================================================
  const mistakeOptions = [
    '無犯錯 (嚴格執行計畫) ✅',
    'FOMO (恐慌性追高/空) 😱',
    '報復性交易 (過度加倉) 😡',
    '提前手動止盈 (抗壓不足) 🏃',
    '凹單/未嚴格執行SL (僥倖心理) 💀',
    '過度交易 (頻繁開倉) 🌀'
  ];

  // ============================================================================
  // PROFESSIONAL POSITION SIZING LOGIC & VERIFIABLE MATH DETAILS
  // ============================================================================
  const sizingReport = useMemo(() => {
    const { entryPrice, stopLossPrice, riskAmount, leverageSizing } = planner;
    if (!entryPrice || !stopLossPrice || entryPrice === stopLossPrice || !riskAmount) {
      return { 
        slPct: 0, openFeeRate: 0, closeFeeRate: 0, totalFeeRate: 0, 
        recommendedSizing: 0, estimatedMargin: 0 
      };
    }
    
    // 1. SL 價差百分比
    const slPct = Math.abs(entryPrice - stopLossPrice) / entryPrice;
    
    // 2. 雙邊 Taker 摩擦費率百分比 (BingX 永續合約開、平倉手續費)
    const openFeeRate = globalSettings.takerFee / 100;
    const closeFeeRate = globalSettings.takerFee / 100;
    const totalFeeRate = openFeeRate + closeFeeRate;
    
    // 3. 建議訂單價值 (Order Value)
    // 公式: OrderValue = RiskAmount / (SL_Distance_Pct + TotalFeeRate)
    const recommendedSizing = riskAmount / (slPct + totalFeeRate);
    
    // 4. 估算保證金 (Margin)
    // 公式: Margin = OrderValue / Leverage
    const estimatedMargin = recommendedSizing / leverageSizing;

    return {
      slPct: parseFloat((slPct * 100).toFixed(4)), // 轉百分比
      openFeeRate: parseFloat((openFeeRate * 100).toFixed(4)),
      closeFeeRate: parseFloat((closeFeeRate * 100).toFixed(4)),
      totalFeeRate: parseFloat((totalFeeRate * 100).toFixed(4)),
      recommendedSizing: parseFloat(recommendedSizing.toFixed(2)),
      estimatedMargin: parseFloat(estimatedMargin.toFixed(2))
    };
  }, [planner.entryPrice, planner.stopLossPrice, planner.riskAmount, planner.leverageSizing, globalSettings]);

  // ============================================================================
  // MATHEMATICAL CALCULATION ENGINE (BINGX COMPLIANT)
  // ============================================================================
  const plannerCalculations = useMemo(() => {
    const { direction, entryPrice, orderValue, stopLossPrice, tps } = planner;
    const isLong = direction === '多';
    
    if (!entryPrice || !orderValue || !stopLossPrice || entryPrice <= 0) {
      return { 
        openFee: 0, closeFeeSL: 0, pnlSL: 0, netPnlSL: 0, 
        plannedGrossPnL: 0, totalCloseFeePlanned: 0, netPlannedPnL: 0, expectedR: 0 
      };
    }

    const openFeeRate = globalSettings.takerFee / 100; 
    const closeFeeRate = globalSettings.makerFee / 100; 
    const closeSLFeeRate = globalSettings.takerFee / 100; 

    const openFee = orderValue * openFeeRate;

    const slPct = (stopLossPrice - entryPrice) / entryPrice;
    const grossPnlSL = isLong 
      ? orderValue * slPct 
      : orderValue * (-slPct);
    const closeFeeSL = orderValue * closeSLFeeRate;
    const netPnlSL = grossPnlSL - closeFeeSL - openFee; 

    let cumulativeTpPercent = 0;
    let plannedGrossPnL = 0;
    let totalCloseFeePlanned = 0;

    const activeTps = tps.filter(tp => tp.active && tp.price > 0 && tp.percent > 0);
    
    activeTps.forEach(tp => {
      const tpPortionValue = orderValue * (tp.percent / 100);
      const tpPct = (tp.price - entryPrice) / entryPrice;
      const tpGross = isLong 
        ? tpPortionValue * tpPct 
        : tpPortionValue * (-tpPct);
      
      const tpCloseFee = tpPortionValue * closeFeeRate;
      
      plannedGrossPnL += tpGross;
      totalCloseFeePlanned += tpCloseFee;
      cumulativeTpPercent += tp.percent;
    });

    const remainingPercent = Math.max(0, 100 - cumulativeTpPercent);
    if (remainingPercent > 0 && activeTps.length > 0) {
      const lastTp = activeTps[activeTps.length - 1];
      const remainingValue = orderValue * (remainingPercent / 100);
      const tpPct = (lastTp.price - entryPrice) / entryPrice;
      const tpGross = isLong 
        ? remainingValue * tpPct 
        : remainingValue * (-tpPct);
      
      const tpCloseFee = remainingValue * closeFeeRate;
      plannedGrossPnL += tpGross;
      totalCloseFeePlanned += tpCloseFee;
    }

    const netPlannedPnL = plannedGrossPnL - totalCloseFeePlanned - openFee;

    const absoluteLoss = Math.abs(netPnlSL);
    const expectedR = absoluteLoss > 0 ? (netPlannedPnL / absoluteLoss) : 0;

    return {
      openFee,
      closeFeeSL,
      pnlSL: grossPnlSL,
      netPnlSL,
      plannedGrossPnL,
      totalCloseFeePlanned,
      netPlannedPnL,
      expectedR: parseFloat(expectedR.toFixed(2))
    };
  }, [planner, globalSettings]);

  // ============================================================================
  // PLANNER EVENT HANDLERS
  // ============================================================================
  const handlePlannerChange = (field, value) => {
    setPlanner(prev => ({ ...prev, [field]: value }));
  };

  const handleTpChange = (id, field, value) => {
    setPlanner(prev => {
      const newTps = prev.tps.map(tp => {
        if (tp.id === id) {
          return { ...tp, [field]: value };
        }
        return tp;
      });
      return { ...prev, tps: newTps };
    });
  };

  const toggleTpActive = (id) => {
    setPlanner(prev => {
      const newTps = prev.tps.map(tp => {
        if (tp.id === id) {
          const nextActive = !tp.active;
          return { ...tp, active: nextActive, percent: nextActive ? 25 : 0 };
        }
        return tp;
      });
      return { ...prev, tps: newTps };
    });
  };

  const handleUploadScreenshot = (e) => {
    if (isInspecting) {
      showToast("唯讀模式：監看狀態下不允許上傳K線圖！", "warning");
      return;
    }
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshotPreview(reader.result);
        setPlanner(prev => ({ ...prev, screenshot: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const clearScreenshot = () => {
    setScreenshotPreview('');
    setPlanner(prev => ({ ...prev, screenshot: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submitPlanToJournal = () => {
    if (isInspecting) {
      showToast("安全防線：管理員在監看模式下，無法在成員的日誌新增計畫單！", "error");
      return;
    }

    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const formattedTime = now.toTimeString().split(' ')[0].substring(0, 5);

    const formattedCoin = (planner.coin || 'BTC').trim().toUpperCase();

    const newRecord = {
      id: 'trade-' + Date.now(),
      date: formattedDate,
      time: formattedTime,
      coin: formattedCoin,
      timeframe: planner.timeframe,
      direction: planner.direction,
      strategy: planner.strategy,
      tpReached: '否', 
      slHit: '否',
      hedged: planner.hedged || '否', 
      riskCoeff: planner.riskCoeff.toString(),
      confidence: planner.confidence,
      expectedR: plannerCalculations.expectedR,
      actualR: 0, 
      plannedPnL: parseFloat(plannerCalculations.netPlannedPnL.toFixed(2)),
      actualPnL: 0, 
      winLoss: '➖ 平', 
      reason: planner.reason || `計畫開倉價: ${planner.entryPrice} | SL: ${planner.stopLossPrice}`,
      chartData: planner.screenshot || '',
      perfChartData: '',
      mistakeTag: planner.mistakeTag || '無犯錯 (嚴格執行計畫) ✅'
    };

    const updatedRecords = [newRecord, ...records];
    setRecords(updatedRecords);
    savePrivateData(updatedRecords);
    showToast("成功建立交易計畫，並已同步到交易日誌！", "success");
    setActiveTab('journal');
  };

  // ============================================================================
  // JOURNAL EVENT HANDLERS & INLINE EDITING
  // ============================================================================
  const updateRecordField = (id, field, value) => {
    if (isInspecting) {
      showToast("安全防線：唯讀模式下無法篡改與編輯學員日誌！", "error");
      return;
    }

    const updated = records.map(rec => {
      if (rec.id === id) {
        const updatedRec = { ...rec, [field]: value };
        if (field === 'actualPnL') {
          const val = parseFloat(value) || 0;
          if (val > 0) {
            updatedRec.winLoss = '✅ 勝';
            updatedRec.tpReached = '是';
            updatedRec.slHit = '否';
          } else if (val < 0) {
            updatedRec.winLoss = '❌ 敗';
            updatedRec.tpReached = '否';
            updatedRec.slHit = '是';
          } else {
            updatedRec.winLoss = '➖ 平';
            updatedRec.tpReached = '否';
            updatedRec.slHit = '否';
          }
        }
        return updatedRec;
      }
      return rec;
    });
    setRecords(updated);
    savePrivateData(updated);
  };

  const deleteRecord = (id) => {
    if (isInspecting) {
      showToast("安全防線：唯讀模式下無法刪除成員的交易紀錄！", "error");
      return;
    }
    setConfirmDeleteId(id);
  };

  const executeDeleteRecord = () => {
    if (isInspecting) return;
    if (!confirmDeleteId) return;
    const updated = records.filter(rec => rec.id !== confirmDeleteId);
    setRecords(updated);
    savePrivateData(updated);
    setConfirmDeleteId(null);
    showToast("交易記錄已刪除", "info");
  };

  // ============================================================================
  // CSV FILE IMPORT / EXPORT ENGINE (COMPLIANT WITH ATTACHED SCHEMA)
  // ============================================================================
  const handleExportCSV = () => {
    const headers = ['日期', '時間', '幣種', '級別', '方向', '策略', '達到止盈', '觸發止損', '套保', '風險係數', '信心', '預計R', '實際R', '計畫盈虧金額', '實際盈虧金額', '勝負', '開倉原因', 'K線圖數據', '績效圖數據', '交易心理學歸因'];
    
    const rows = records.map(rec => [
      rec.date,
      rec.time,
      rec.coin,
      rec.timeframe,
      rec.direction,
      rec.strategy,
      rec.tpReached,
      rec.slHit,
      rec.hedged || '否',
      rec.riskCoeff,
      rec.confidence,
      rec.expectedR,
      rec.actualR,
      rec.plannedPnL,
      rec.actualPnL,
      rec.winLoss,
      rec.reason ? rec.reason.replace(/,/g, '，') : '',
      rec.chartData ? "[BASE64_IMAGE]" : "", 
      rec.perfChartData ? "[BASE64_IMAGE]" : "",
      rec.mistakeTag || '無犯錯 (嚴格執行計畫) ✅'
    ]);

    let csvContent = "\uFEFF" + headers.join(",") + "\n"; 
    rows.forEach(row => {
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${activeMemberConfig.nickname}_records_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`成功導出 ${activeMemberConfig.nickname} 的覆盤日誌 CSV`, "success");
  };

  const handleImportCSV = (e) => {
    if (isInspecting) {
      showToast("安全防線：無法向受監看學員日誌導入 CSV！", "error");
      return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const lines = text.split('\n');
        if (lines.length < 2) {
          showToast("CSV 格式不正確或為空檔案", "error");
          return;
        }

        const recordsParsed = [];

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          
          const columns = [];
          let current = "";
          let inQuotes = false;
          
          for (let char of lines[i]) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              columns.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          columns.push(current.trim());

          if (columns.length < 5) continue; 

          recordsParsed.push({
            id: 'csv-' + Date.now() + '-' + i,
            date: columns[0] || new Date().toISOString().split('T')[0],
            time: columns[1] || '00:00',
            coin: (columns[2] || 'BTC').toUpperCase(),
            timeframe: columns[3] || '1小時',
            direction: columns[4] || '多',
            strategy: columns[5] || '一般開倉',
            tpReached: columns[6] || '否',
            slHit: columns[7] || '否',
            hedged: columns[8] || '否', 
            riskCoeff: columns[9] || '1.0',
            confidence: parseInt(columns[10]) || 5,
            expectedR: parseFloat(columns[11]) || 0,
            actualR: parseFloat(columns[12]) || 0,
            plannedPnL: parseFloat(columns[13]) || 0,
            actualPnL: parseFloat(columns[14]) || 0,
            winLoss: columns[15] || '➖ 平',
            reason: columns[16] || '',
            chartData: columns[17] === '[BASE64_IMAGE]' ? '' : (columns[17] || ''),
            perfChartData: columns[18] === '[BASE64_IMAGE]' ? '' : (columns[18] || ''),
            mistakeTag: columns[19] || '無犯錯 (嚴格執行計畫) ✅'
          });
        }

        if (recordsParsed.length > 0) {
          const merged = [...recordsParsed, ...records];
          const uniqueMerged = merged.filter((item, index, self) =>
            self.findIndex(t => t.date === item.date && t.time === item.time && t.coin === item.coin && t.direction === item.direction) === index
          );
          setRecords(uniqueMerged);
          savePrivateData(uniqueMerged);
          showToast(`成功導入 ${recordsParsed.length} 筆交易紀錄！`, "success");
        } else {
          showToast("無有效數據導入", "warning");
        }
      } catch (err) {
        console.error("CSV Import Error: ", err);
        showToast("解析 CSV 失敗，請確認檔案編碼與格式", "error");
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  // ============================================================================
  // PERFORMANCE ANALYTICS ENGINE (EXCLUDES HEDGED TRADES FROM WINRATE)
  // ============================================================================
  const stats = useMemo(() => {
    const closedTrades = records.filter(rec => rec.winLoss !== '➖ 平');
    const conventionalTrades = closedTrades.filter(rec => rec.hedged !== '是');
    
    const totalTrades = records.length;
    const wins = conventionalTrades.filter(rec => rec.winLoss.includes('勝')).length;
    const losses = conventionalTrades.filter(rec => rec.winLoss.includes('敗')).length;
    
    const winRate = conventionalTrades.length > 0 ? (wins / conventionalTrades.length) * 100 : 0;
    const totalHedged = records.filter(rec => rec.hedged === '是').length;
    const closedHedged = closedTrades.filter(rec => rec.hedged === 'true' || rec.hedged === '是').length;

    let totalProfit = 0;
    let totalLoss = 0;
    let totalR = 0;
    let actualPnLSum = 0;

    records.forEach(rec => {
      const pnl = parseFloat(rec.actualPnL) || 0;
      actualPnLSum += pnl;
      totalR += parseFloat(rec.actualR) || 0;

      if (pnl > 0) {
        totalProfit += pnl;
      } else {
        totalLoss += Math.abs(pnl);
      }
    });

    const profitFactor = totalLoss > 0 ? (totalProfit / totalLoss) : totalProfit > 0 ? 99.9 : 0;

    const coinStats = {};
    records.forEach(rec => {
      if (!coinStats[rec.coin]) {
        coinStats[rec.coin] = { count: 0, wins: 0, pnl: 0, hedgedCount: 0 };
      }
      coinStats[rec.coin].pnl += parseFloat(rec.actualPnL) || 0;
      
      if (rec.hedged === '是') {
        coinStats[rec.coin].hedgedCount += 1;
      } else {
        coinStats[rec.coin].count += 1;
        if (rec.winLoss.includes('勝')) {
          coinStats[rec.coin].wins += 1;
        }
      }
    });

    const strategyStats = {};
    records.forEach(rec => {
      const strat = rec.strategy || '未設定';
      if (!strategyStats[strat]) {
        strategyStats[strat] = { count: 0, wins: 0, pnl: 0 };
      }
      strategyStats[strat].count += 1;
      strategyStats[strat].pnl += parseFloat(rec.actualPnL) || 0;
      if (rec.winLoss.includes('勝')) {
        strategyStats[strat].wins += 1;
      }
    });

    const mistakeStats = {};
    records.forEach(rec => {
      const tag = rec.mistakeTag || '無犯錯 (嚴格執行計畫) ✅';
      if (!mistakeStats[tag]) {
        mistakeStats[tag] = { count: 0, pnl: 0 };
      }
      mistakeStats[tag].count += 1;
      mistakeStats[tag].pnl += parseFloat(rec.actualPnL) || 0;
    });

    return {
      totalTrades,
      closedTrades: closedTrades.length,
      conventionalTradesCount: conventionalTrades.length,
      wins,
      losses,
      winRate: winRate.toFixed(1),
      profitFactor: profitFactor.toFixed(2),
      totalR: totalR.toFixed(2),
      actualPnLSum: actualPnLSum.toFixed(2),
      totalHedged,
      closedHedged,
      coinStats,
      strategyStats,
      mistakeStats
    };
  }, [records]);

  // Equity Curve Timeline Data
  const chartPoints = useMemo(() => {
    const sorted = [...records].sort((a, b) => {
      return new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`);
    });

    let currentBalance = activeMemberConfig.defaultRiskCapital;
    let currentR = 0;
    const points = [{ balance: currentBalance, r: 0, date: '初始狀態' }];

    sorted.forEach(rec => {
      currentBalance += parseFloat(rec.actualPnL) || 0;
      currentR += parseFloat(rec.actualR) || 0;
      points.push({
        balance: currentBalance,
        r: currentR,
        date: `${rec.date} ${rec.time}`,
        coin: rec.coin
      });
    });

    return points;
  }, [records, activeMemberConfig.defaultRiskCapital]);

  // Optimized SVG Line Chart Visual Pre-calculations (Clears "React Child Object" errors)
  const chartVisualData = useMemo(() => {
    if (chartPoints.length <= 1) return null;
    const maxBalance = Math.max(...chartPoints.map(p => p.balance)) * 1.05;
    const minBalance = Math.min(...chartPoints.map(p => p.balance)) * 0.95;
    const range = maxBalance - minBalance || 1000;
    
    const widthInterval = 1000 / (chartPoints.length - 1);
    const points = chartPoints.map((pt, idx) => {
      const x = idx * widthInterval;
      const y = 300 - ((pt.balance - minBalance) / range) * 250 - 25; 
      return { x, y, pt, idx };
    });

    const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaStr = `${pointsStr} 1000,300 0,300`;

    return { points, pointsStr, areaStr };
  }, [chartPoints]);

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#e2e8f0] font-sans flex flex-col selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* GLOBAL TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl border transition-all duration-300 ${
          toast.type === 'success' ? 'bg-[#102a1e] border-emerald-500/40 text-emerald-300' :
          toast.type === 'error' ? 'bg-[#2a1212] border-rose-500/40 text-rose-300' :
          'bg-[#221e10] border-amber-500/40 text-amber-300'
        }`}>
          <div className="w-2 h-2 rounded-full animate-ping bg-current" />
          <span className="font-medium text-sm">{toast.message}</span>
        </div>
      )}

      {/* ADMIN INSPECTING USER PERSISTENT WARNING BANNER */}
      {isInspecting && (
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-[#0d0f12] px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xl font-bold text-xs sticky top-[73px] z-30 animate-pulse">
          <div className="flex items-center gap-2.5">
            <span className="text-sm">👁️</span>
            <span>
              正在以管理員身份監看學員：
              <span className="bg-[#0d0f12] text-amber-400 px-2 py-0.5 rounded ml-1 font-mono text-xs">
                {activeMemberConfig.nickname}
              </span> 的實戰終端 (🔒 唯讀防篡改模式已啟動)
            </span>
            </div>
          <button 
            onClick={() => {
              if (user) {
                setViewingUid(user.uid);
                setInspectedMemberConfig(null);
                showToast("已安全退出監看模式，回到個人控制台", "info");
              }
            }}
            className="bg-[#0d0f12] hover:bg-[#151c2a] text-amber-400 border border-amber-500/30 px-4 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-colors"
          >
            退出監看模式 🚪
          </button>
        </div>
      )}

      {/* EMAIL VERIFICATION WARNING BANNER */}
      {user && !user.isAnonymous && !user.emailVerified && (
        <div className="bg-amber-950/80 border-b border-amber-500/30 text-amber-300 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs font-semibold">
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <span>您的電子信箱尚未完成驗證！請檢查您的驗證信件以啟動安全雲端自動保存。</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleResendVerification}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-3 py-1 rounded-lg transition-colors font-bold"
            >
              🚀 重新寄送驗證信
            </button>
          </div>
        </div>
      )}

      {/* METABAR / NAVIGATION SYSTEM HEADER */}
      <header className="sticky top-0 z-40 bg-[#0d0f12]/90 backdrop-blur-md border-b border-[#1e2330] px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-tr from-emerald-500 to-teal-400 p-2.5 rounded-xl shadow-lg shadow-emerald-950/20">
            <svg className="w-6 h-6 text-[#0d0f12]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                QuantTrader Pro
              </h1>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono">
                v5.0
              </span>
            </div>
            <p className="text-xs text-[#64748b]">交易規劃＆分析系統</p>
            </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <nav className="flex items-center gap-1.5 bg-[#141822] p-1 rounded-xl border border-[#1e2330]">
          <button 
            onClick={() => setActiveTab('planner')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'planner' 
                ? 'bg-[#1e2538] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#181f30]'
            }`}
          >
            📈 規劃器
          </button>
          <button 
            onClick={() => setActiveTab('journal')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'journal' 
                ? 'bg-[#1e2538] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#181f30]'
            }`}
          >
            📔 日誌
          </button>
          <button 
            onClick={() => setActiveTab('performance')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'performance' 
                ? 'bg-[#1e2538] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#181f30]'
            }`}
          >
            📊 績效
          </button>
          
          {/* INDEPENDENT ADMIN PORTAL TAB */}
          {isStaff && (
            <button 
              onClick={() => setActiveTab('adminPortal')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-bold transition-all relative ${
                activeTab === 'adminPortal' 
                  ? 'bg-violet-950/40 text-violet-400 border border-violet-500/25 shadow-sm' 
                  : 'text-violet-400/80 hover:text-violet-300 hover:bg-[#181f30]'
              }`}
            >
              👑 管理後台
              <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
              </span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'settings' 
                ? 'bg-[#1e2538] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#181f30]'
            }`}
          >
            ⚙️ 設定
          </button>
        </nav>

        {/* Realtime Environment Metrics & Auth Controls */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-[#64748b]">帳戶預算:</span>
            <span className="text-[#e2e8f0] font-bold">${activeMemberConfig.defaultRiskCapital.toLocaleString()} {activeMemberConfig.baseCurrency}</span>
          </div>

          <div className="h-8 w-[1px] bg-[#1e2330] hidden lg:block" />

          {/* User Account / Login trigger */}
          {user && !user.isAnonymous ? (
            <div className="flex items-center gap-2 bg-[#141822] border border-[#1e2330] px-3.5 py-1.5 rounded-xl">
              {user.photoURL ? (
                <img src={user.photoURL} className="w-6 h-6 rounded-full object-cover" alt="avatar" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 flex items-center justify-center font-bold text-[#0d0f12] text-[10px]">
                  {(memberConfig.nickname ? memberConfig.nickname[0] : (user.email ? user.email[0] : 'U')).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col max-w-[100px]">
                <span className="text-[10px] text-emerald-400 font-bold truncate flex items-center gap-1">
                  <span>{memberConfig.nickname || '交易員'}</span>
                  {currentUserRole === 'owner' && <span title="擁有者" className="text-violet-400">💎</span>}
                  {currentUserRole === 'admin' && <span title="管理員" className="text-blue-400">🛠️</span>}
                  {currentUserRole === 'viewer' && <span title="檢視員" className="text-amber-400">👁️</span>}
                </span>
                <span className="text-[#64748b] text-[9px] truncate">{user.email}</span>
              </div>
              <button 
                onClick={handleSignOut}
                className="text-slate-500 hover:text-rose-400 ml-1.5 font-bold transition-colors text-[10px]"
                title="安全登出"
              >
                🚪
              </button>
            </div>
          ) : (
            <button 
              onClick={() => {
                setAuthMode('login');
                setShowAuthModal(true);
              }}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-[#0d0f12] font-black px-4 py-2 rounded-xl transition-all shadow-md shadow-emerald-950/20 animate-pulse"
            >
              🔑 登入帳戶
            </button>
          )}
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">

        {/* 1. TRADE PLANNER SECTION */}
        {activeTab === 'planner' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Side: Parameters Inputs */}
            <div className="lg:col-span-7 bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 space-y-6 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#1e2330] pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">💡</span>
                  <h2 className="text-lg font-bold">
                    {isInspecting ? `監看中：${activeMemberConfig.nickname} 的計畫配置` : 'BingX 永續合約開單規劃'}
                  </h2>
                </div>
                <div className="flex gap-1.5 bg-[#141822] p-1 rounded-lg border border-[#1e2330]">
                  <button 
                    onClick={() => handlePlannerChange('direction', '多')}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                      planner.direction === '多' 
                        ? 'bg-emerald-500 text-[#0d0f12]' 
                        : 'text-[#94a3b8] hover:text-[#f8fafc]'
                    }`}
                    disabled={isInspecting}
                  >
                    LONG / 做多
                  </button>
                  <button 
                    onClick={() => handlePlannerChange('direction', '空')}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                      planner.direction === '空' 
                        ? 'bg-rose-500 text-[#f8fafc]' 
                        : 'text-[#94a3b8] hover:text-[#f8fafc]'
                    }`}
                    disabled={isInspecting}
                  >
                    SHORT / 做空
                  </button>
                </div>
              </div>

              {/* Calculator Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Custom Coin Input & Dropdown Integrator */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">交易標的 (幣種)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      list="coins-datalist"
                      value={planner.coin}
                      onChange={(e) => handlePlannerChange('coin', e.target.value.toUpperCase())}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="輸入或選擇 (如 BTC/ETH/SOL)"
                      disabled={isInspecting}
                    />
                    <datalist id="coins-datalist">
                      {globalSettings.coins.map(c => <option key={c} value={c}>{c}</option>)}
                    </datalist>
                  </div>
                  <p className="text-[10px] text-[#64748b] mt-1">💡 支援自由鍵入任何自訂新幣種</p>
                </div>

                {/* Timeframe: Input with Datalist to support unlimited custom timeframes */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">分析級別 (Timeframe)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      list="timeframes-datalist"
                      value={planner.timeframe}
                      onChange={(e) => handlePlannerChange('timeframe', e.target.value)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="自訂或選擇級別 (如 3分鐘, 12分鐘)"
                      disabled={isInspecting}
                    />
                    <datalist id="timeframes-datalist">
                      {globalSettings.timeframes.map(t => <option key={t} value={t}>{t}</option>)}
                    </datalist>
                  </div>
                  <p className="text-[10px] text-[#64748b] mt-1">💡 支援自由鍵入自訂時間級別</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    開倉點位 (Entry Price)
                  </label>
                  <div className="relative">
                    <input 
                      type="number" 
                      value={planner.entryPrice}
                      onChange={(e) => handlePlannerChange('entryPrice', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl pl-3.5 pr-12 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="0.00"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#64748b]">USDT</span>
                  </div>
                </div>

                {/* 🏆 Renamed to "SL" directly */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    SL
                  </label>
                  <div className="relative">
                    <input 
                      type="number" 
                      value={planner.stopLossPrice}
                      onChange={(e) => handlePlannerChange('stopLossPrice', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl pl-3.5 pr-12 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="SL 價格 (USDT)"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#64748b]">USDT</span>
                  </div>
                </div>

                {/* BingX Order Value input */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    BingX 訂單價值 (Order Value)
                  </label>
                  <div className="relative">
                    <input 
                      type="number" 
                      value={planner.orderValue}
                      onChange={(e) => handlePlannerChange('orderValue', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl pl-3.5 pr-12 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="即槓桿 x 保證金的總合價值"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#64748b]">USDT</span>
                  </div>
                  <p className="text-[10px] text-[#64748b] mt-1">例如: 100 USDT 保證金 x 100 槓桿 = 10,000 USDT</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">信心 (1-10)</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="10" 
                      value={planner.confidence}
                      onChange={(e) => handlePlannerChange('confidence', parseInt(e.target.value) || 5)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none"
                      disabled={isInspecting}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">風險係數 (R)</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={planner.riskCoeff}
                      onChange={(e) => handlePlannerChange('riskCoeff', parseFloat(e.target.value) || 1.0)}
                      className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none"
                      disabled={isInspecting}
                    />
                  </div>
                </div>
              </div>

              {/* 🏆 NEW Veteran Optimization: Professional R-Risk Smart Position Sizing Module */}
              <div className="p-4 bg-gradient-to-r from-[#141822] to-[#1d2436] rounded-xl border border-emerald-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <span>🛡️</span> R-Risk 智能算倉系統 (按 SL 距離推算倉位)
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={planner.useSmartSizing} 
                      onChange={(e) => handlePlannerChange('useSmartSizing', e.target.checked)}
                      className="sr-only peer"
                      disabled={isInspecting}
                    />
                    <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {planner.useSmartSizing && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-[10px] text-[#94a3b8] mb-1 uppercase font-bold tracking-wider">單筆最大承受損失 (R)</label>
                        <div className="relative">
                          <input 
                            type="number" 
                            value={planner.riskAmount} 
                            onChange={(e) => handlePlannerChange('riskAmount', parseFloat(e.target.value) || 0)}
                            className="w-full bg-[#0d0f12] border border-[#1e2330] rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 font-bold font-mono"
                            disabled={isInspecting}
                          />
                          <span className="absolute right-2 top-1.5 text-[10px] font-bold text-slate-500">USDT</span>
                        </div>
                      </div>

                      {/* 🏆 Leverage Selector Slider to avoid confusing "Order Value" with "Margin" */}
                      <div>
                        <label className="block text-[10px] text-[#94a3b8] mb-1 uppercase font-bold tracking-wider">
                          預計槓桿: <span className="text-amber-400 font-mono font-bold">{planner.leverageSizing}x</span>
                        </label>
                        <input 
                          type="range"
                          min="1"
                          max="150"
                          value={planner.leverageSizing}
                          onChange={(e) => handlePlannerChange('leverageSizing', parseInt(e.target.value) || 20)}
                          className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                          disabled={isInspecting}
                        />
                      </div>

                      <div>
                        <button
                          onClick={() => {
                            if (sizingReport.recommendedSizing > 0) {
                              handlePlannerChange('orderValue', sizingReport.recommendedSizing);
                              showToast(`已成功套用建議訂單價值：$${sizingReport.recommendedSizing.toLocaleString()} USDT`, "success");
                            } else {
                              showToast("請先輸入有效的開倉點位、SL 與最大承受損失", "warning");
                            }
                          }}
                          disabled={isInspecting || sizingReport.recommendedSizing <= 0}
                          className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 py-1.5 rounded-lg text-xs font-black transition-all disabled:opacity-30 flex items-center justify-center gap-1"
                        >
                          ⚡ 填入訂單價值
                        </button>
                      </div>
                    </div>

                    {/* Step-by-Step Verifiable Math Breakdown Cards (Eliminates Sizing Misunderstandings) */}
                    <div className="bg-[#0d0f12]/60 rounded-lg p-3.5 border border-[#1e2330] space-y-2.5 text-xs font-mono">
                      <div className="text-slate-400 font-bold border-b border-[#1e2330] pb-1.5 flex justify-between">
                        <span>🧮 算倉公式即時推導明細</span>
                        <span className="text-emerald-400">BingX 標準永續合約計費</span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-500">1. SL 價差距離:</span>{' '}
                          <span className="text-[#f8fafc] font-bold">{sizingReport.slPct}%</span>
                        </div>
                        <div>
                          <span className="text-slate-500">2. 雙邊 Taker 費率:</span>{' '}
                          <span className="text-[#f8fafc] font-bold">{sizingReport.totalFeeRate}%</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-slate-500">3. 單筆受損風險值:</span>{' '}
                          <span className="text-emerald-400 font-bold">${planner.riskAmount} USDT</span>
                        </div>
                      </div>

                      <div className="pt-1.5 border-t border-[#1e2330]/60 space-y-1">
                        <div className="flex justify-between items-center bg-[#141822] p-2 rounded border border-[#1e2330]">
                          <span className="text-slate-400 font-semibold">建議 BingX 訂單價值 (Order Value):</span>
                          <span className="text-emerald-400 font-black text-sm">
                            ${sizingReport.recommendedSizing.toLocaleString()} USDT
                          </span>
                        </div>
                        <div className="flex justify-between items-center bg-[#141822] p-2 rounded border border-[#1e2330]">
                          <span className="text-slate-400 font-semibold flex items-center gap-1">
                            <span>💡</span> 實收開倉保證金 (Margin) 估算:
                          </span>
                          <span className="text-amber-400 font-black text-sm">
                            ${sizingReport.estimatedMargin.toLocaleString()} USDT <span className="text-[10px] text-slate-500 font-normal">({planner.leverageSizing}x)</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {!planner.useSmartSizing && (
                  <p className="text-[10px] text-slate-500">
                    💡 啟用智能算倉後，系統會結合您的 **SL 距離百分比** 與 **雙邊手續費率**，精確推算出保證金與訂單價值的平衡點。
                  </p>
                )}
              </div>

              {/* Advanced Multi-TP Configuration Section */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                    分批止盈策略設計 (Multi-TP Exit)
                  </label>
                  <span className="text-xs font-semibold text-[#64748b]">
                    已分配平倉比例: {planner.tps.reduce((acc, curr) => acc + (curr.active ? curr.percent : 0), 0)}%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {planner.tps.map((tp) => (
                    <div 
                      key={tp.id} 
                      className={`p-3.5 rounded-xl border transition-all ${
                        tp.active 
                          ? 'bg-[#141822] border-emerald-500/20' 
                          : 'bg-[#141822]/40 border-[#1e2330]/60 opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-emerald-400">TP {tp.id}</span>
                        <button 
                          onClick={() => toggleTpActive(tp.id)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            tp.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                          }`}
                          disabled={isInspecting}
                        >
                          {tp.active ? '已啟用' : '未啟用'}
                        </button>
                      </div>

                      {tp.active && (
                        <div className="flex gap-2.5">
                          <div className="flex-1">
                            <label className="block text-[10px] text-[#64748b] mb-1">平倉價格</label>
                            <input 
                              type="number" 
                              value={tp.price || ''}
                              onChange={(e) => handleTpChange(tp.id, 'price', parseFloat(e.target.value) || 0)}
                              className="w-full bg-[#0d0f12] border border-[#1e2330] rounded-lg px-2.5 py-1.5 text-xs text-[#f8fafc]"
                              placeholder="0.00"
                              disabled={isInspecting}
                            />
                          </div>
                          <div className="w-24">
                            <label className="block text-[10px] text-[#64748b] mb-1">平倉比例 %</label>
                            <input 
                              type="number" 
                              value={tp.percent || ''}
                              onChange={(e) => handleTpChange(tp.id, 'percent', parseInt(e.target.value) || 0)}
                              className="w-full bg-[#0d0f12] border border-[#1e2330] rounded-lg px-2.5 py-1.5 text-xs text-[#f8fafc]"
                              placeholder="25%"
                              disabled={isInspecting}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Extra Planner Meta Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">套用交易策略</label>
                  <select 
                    value={planner.strategy}
                    onChange={(e) => handlePlannerChange('strategy', e.target.value)}
                    className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    {globalSettings.strategies.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">套保交易 (Hedged)</label>
                  <select 
                    value={planner.hedged}
                    onChange={(e) => handlePlannerChange('hedged', e.target.value)}
                    className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    <option value="否">🔓 否 (計入常規勝率)</option>
                    <option value="是">🔒 是 (套保不計勝率)</option>
                  </select>
                </div>

                {/* 🏆 Veteran Optimization: Psychological Tagging */}
                <div className="md:col-span-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">交易心理與犯錯覆盤</label>
                  <select 
                    value={planner.mistakeTag}
                    onChange={(e) => handlePlannerChange('mistakeTag', e.target.value)}
                    className="w-full bg-[#141822] border border-[#1e2330] rounded-xl px-3.5 py-2.5 text-sm font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    {mistakeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </div>

              {/* Upload Screenshot preview card inside Planner */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">上傳 K 線/分析圖檔</label>
                  <div className="flex gap-2">
                    <input 
                      type="file" 
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleUploadScreenshot}
                      className="hidden"
                      disabled={isInspecting}
                    />
                    <button 
                      onClick={() => fileInputRef.current.click()}
                      className="flex-1 bg-[#141822] hover:bg-[#1b2130] border border-[#1e2330] rounded-xl px-3.5 py-2 text-xs font-bold text-[#e2e8f0] transition-colors disabled:opacity-50"
                      disabled={isInspecting}
                    >
                      {screenshotPreview ? '📸 已選擇' : '📁 選擇 K 線或覆盤分析截圖...'}
                    </button>
                    {screenshotPreview && (
                      <button 
                        onClick={clearScreenshot}
                        className="bg-rose-950/40 border border-rose-500/20 text-rose-400 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-rose-900/50"
                        disabled={isInspecting}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">開倉依據與覆盤備忘 (Entry Reason)</label>
                <textarea 
                  value={planner.reason}
                  onChange={(e) => handlePlannerChange('reason', e.target.value)}
                  rows="2"
                  className="w-full bg-[#141822] border border-[#1e2330] rounded-xl p-3.5 text-xs text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                  placeholder="請在此處紀錄 K 線架撐、FVG 缺口、流動性清算或催化因子..."
                  disabled={isInspecting}
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={submitPlanToJournal}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-[#0d0f12] font-extrabold py-3.5 px-6 rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/10 active:scale-95 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed"
                  disabled={isInspecting}
                >
                  {isInspecting ? '🔒 唯讀模式：監管限制不允許操作' : '🚀 建立計畫並提交至日誌'}
                </button>
              </div>

            </div>

            {/* Right Side: Professional Calculations Live Monitor */}
            <div className="lg:col-span-5 space-y-6">
              
              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 space-y-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -z-10" />
                
                <div className="flex items-center justify-between border-b border-[#1e2330] pb-4">
                  <h3 className="font-bold text-sm tracking-wider uppercase text-[#64748b]">實時計畫監控模組</h3>
                  <span className="text-[10px] font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                    {planner.hedged === '是' ? '🔒 套保單隔離計算' : 'BingX 標準計算'}
                  </span>
                </div>

                {/* Main Metrics Card */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#141822] p-4 rounded-xl border border-[#1e2330]">
                    <span className="text-[10px] font-bold text-[#64748b] block mb-1">預計最優淨盈虧</span>
                    <span className="text-xl font-black text-emerald-400 font-mono">
                      +${plannerCalculations.netPlannedPnL.toFixed(2)}
                    </span>
                    <span className="block text-[9px] text-[#64748b] mt-1">(已扣除手續費)</span>
                  </div>

                  <div className="bg-[#141822] p-4 rounded-xl border border-[#1e2330]">
                    <span className="text-[10px] font-bold text-[#64748b] block mb-1">計畫最大淨虧損</span>
                    <span className="text-xl font-black text-rose-400 font-mono">
                      -${Math.abs(plannerCalculations.netPnlSL).toFixed(2)}
                    </span>
                    <span className="block text-[9px] text-[#64748b] mt-1">(觸發SL計費)</span>
                  </div>
                </div>

                {/* Big Expected R Display */}
                <div className="bg-gradient-to-br from-[#141822] to-[#1a2132] p-5 rounded-2xl border border-[#1e2330] flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#94a3b8] block">預期 R 盈虧比 (R-Value)</span>
                    <p className="text-[10px] text-[#64748b] mt-0.5">以每單位風險 (1R) 換取之預期利潤比</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-4xl font-extrabold font-mono ${plannerCalculations.expectedR >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {plannerCalculations.expectedR} R
                    </span>
                  </div>
                </div>

                {/* Professional Fee breakdown logs */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-[#94a3b8]">手續費與資金折損明細 (永續合約計入法)</h4>
                  
                  <div className="bg-[#0d0f12] p-4 rounded-xl border border-[#1e2330] space-y-2 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">開倉手續費 (Taker):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.openFee.toFixed(2)} USDT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">觸發SL平倉手續費 (Taker):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.closeFeeSL.toFixed(2)} USDT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">計畫止盈平倉手續費 (Maker):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.totalCloseFeePlanned.toFixed(2)} USDT</span>
                    </div>
                    <div className="h-[1px] bg-[#1e2330] my-1" />
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-[#94a3b8]">單次開關單最高摩擦成本:</span>
                      <span className="text-amber-400">
                        ${(plannerCalculations.openFee + Math.max(plannerCalculations.closeFeeSL, plannerCalculations.totalCloseFeePlanned)).toFixed(2)} USDT
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Chart Live Preview Frame */}
              {screenshotPreview && (
                <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-[#94a3b8] uppercase">K線圖分析預覽</span>
                    <button 
                      onClick={clearScreenshot}
                      className="text-xs text-rose-400 font-bold hover:underline"
                    >
                      移除圖檔
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-[#1e2330] bg-[#0d0f12] relative max-h-[220px] flex items-center justify-center">
                    <img src={screenshotPreview} alt="Chart preview" className="w-full object-cover" />
                  </div>
                </div>
              )}

            </div>

          </div>
        )}

        {/* 2. TRADING JOURNAL TABLE SECTION */}
        {activeTab === 'journal' && (
          <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl space-y-6">
            
            {/* Journal Sub Header Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2330] pb-4">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">📓</span>
                <div>
                  <h2 className="text-lg font-bold">
                    {isInspecting ? `💎 正在查閱：${activeMemberConfig.nickname} 的歷史覆盤日誌` : '實戰交易覆盤日誌'}
                  </h2>
                  <p className="text-xs text-[#64748b]">
                    {isInspecting ? '🔒 當前為管理端穿透唯讀模式' : '支援即時編輯實際 PnL 與套保狀態（套保單自動排除於投機勝率統計外）'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input 
                  type="file" 
                  accept=".csv"
                  ref={csvImportRef}
                  onChange={handleImportCSV}
                  className="hidden"
                />
                
                <button 
                  onClick={() => csvImportRef.current.click()}
                  className="bg-[#141822] hover:bg-[#1b2130] border border-[#1e2330] text-emerald-400 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors disabled:opacity-50"
                  disabled={isInspecting}
                >
                  📥 匯入歷史紀錄 (CSV)
                </button>

                <button 
                  onClick={handleExportCSV}
                  className="bg-emerald-500 hover:bg-emerald-400 text-[#0d0f12] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/5"
                >
                  📤 導出數據備份 (CSV)
                </button>
              </div>
            </div>

            {/* High Fidelity Scrollable Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1e2330] text-[11px] uppercase tracking-wider text-[#64748b] font-bold">
                    <th className="py-3 px-4">時間與幣種</th>
                    <th className="py-3 px-2">級別</th>
                    <th className="py-3 px-2">方向</th>
                    <th className="py-3 px-3">使用策略</th>
                    <th className="py-3 px-2 text-center">TP/SL</th>
                    <th className="py-3 px-2 text-center">套保</th>
                    <th className="py-3 px-2 text-center">心理覆盤</th>
                    <th className="py-3 px-2 text-center">信心</th>
                    <th className="py-3 px-3 text-right">預計R / 實際R</th>
                    <th className="py-3 px-3 text-right">計畫 / 實際 PnL</th>
                    <th className="py-3 px-3 text-center">勝負</th>
                    <th className="py-3 px-4">開倉依據 / 備註</th>
                    <th className="py-3 px-3 text-center">分析圖</th>
                    <th className="py-3 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2330]/50 text-sm">
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan="14" className="py-12 text-center text-[#64748b] font-medium">
                        目前沒有交易紀錄。請先使用規劃器建立新計畫或匯入歷史 CSV。
                      </td>
                    </tr>
                  ) : (
                    records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-[#141822]/60 transition-colors">
                        <td className="py-4 px-4">
                          <div className="font-bold text-[#f8fafc]">{rec.coin}/USDT</div>
                          <div className="text-[10px] text-[#64748b] font-mono">{rec.date} {rec.time}</div>
                        </td>
                        <td className="py-4 px-2">
                          <span className="text-xs font-semibold bg-[#1a1f2e] text-[#94a3b8] px-2 py-0.5 rounded">
                            {rec.timeframe}
                          </span>
                        </td>
                        <td className="py-4 px-2">
                          <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded ${
                            rec.direction === '多' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {rec.direction}
                          </span>
                        </td>
                        <td className="py-4 px-3">
                          <span className="text-xs font-medium text-[#e2e8f0]">{rec.strategy}</span>
                        </td>
                        <td className="py-4 px-2">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              rec.tpReached === '是' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                            }`}>
                              TP: {rec.tpReached}
                            </span>
                            {/* 🏆 SL Renaming */}
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              rec.slHit === '是' ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-800 text-slate-500'
                            }`}>
                              SL: {rec.slHit}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-2 text-center">
                          <select 
                            value={rec.hedged || '否'}
                            onChange={(e) => updateRecordField(rec.id, 'hedged', e.target.value)}
                            className={`text-xs font-bold rounded px-2 py-1 text-center bg-[#0d0f12] border ${
                              rec.hedged === '是' 
                                ? 'border-amber-500/30 text-amber-400 bg-amber-500/5' 
                                : 'border-slate-800 text-slate-400'
                            }`}
                            disabled={isInspecting}
                          >
                            <option value="否">🔓 否</option>
                            <option value="是">🔒 是</option>
                          </select>
                        </td>
                        {/* 🏆 Interactive Mistake Tag Dropdown inside Journal */}
                        <td className="py-4 px-2">
                          <select
                            value={rec.mistakeTag || '無犯錯 (嚴格執行計畫) ✅'}
                            onChange={(e) => updateRecordField(rec.id, 'mistakeTag', e.target.value)}
                            className="text-xs bg-[#0d0f12] border border-[#1e2330] rounded p-1 text-[#94a3b8] focus:text-[#f8fafc]"
                            disabled={isInspecting}
                          >
                            {mistakeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </td>
                        <td className="py-4 px-2 text-center font-mono font-bold text-amber-400">
                          {rec.confidence}/10
                        </td>
                        <td className="py-4 px-3 text-right font-mono">
                          <div className="text-[#64748b] text-xs">預計: <span className="text-[#e2e8f0] font-bold">{rec.expectedR}R</span></div>
                          
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[10px] text-emerald-500">實際:</span>
                            <input 
                              type="number" 
                              step="0.05"
                              value={rec.actualR}
                              onChange={(e) => updateRecordField(rec.id, 'actualR', parseFloat(e.target.value) || 0)}
                              className="w-16 bg-[#0d0f12] border border-[#1e2330] rounded px-1.5 py-0.5 text-xs text-right font-bold text-emerald-400"
                              disabled={isInspecting}
                            />
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right font-mono">
                          <div className="text-[#64748b] text-xs">計畫: <span className="text-[#e2e8f0] font-bold">${rec.plannedPnL}</span></div>
                          
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[10px] text-emerald-500">$實際:</span>
                            <input 
                              type="number" 
                              value={rec.actualPnL}
                              onChange={(e) => updateRecordField(rec.id, 'actualPnL', parseFloat(e.target.value) || 0)}
                              className="w-20 bg-[#0d0f12] border border-[#1e2330] rounded px-1.5 py-0.5 text-xs text-right font-bold text-emerald-400"
                              disabled={isInspecting}
                            />
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center">
                          <select 
                            value={rec.winLoss}
                            onChange={(e) => updateRecordField(rec.id, 'winLoss', e.target.value)}
                            className={`text-xs font-bold rounded px-1.5 py-1 text-center bg-[#0d0f12] border ${
                              rec.winLoss.includes('勝') ? 'border-emerald-500/30 text-emerald-400' :
                              rec.winLoss.includes('敗') ? 'border-rose-500/30 text-rose-400' :
                              'border-slate-700 text-slate-400'
                            }`}
                            disabled={isInspecting}
                          >
                            <option value="✅ 勝">✅ 勝</option>
                            <option value="❌ 敗">❌ 敗</option>
                            <option value="➖ 平">➖ 平</option>
                          </select>
                        </td>
                        <td className="py-4 px-4 max-w-[220px]">
                          <textarea 
                            value={rec.reason}
                            onChange={(e) => updateRecordField(rec.id, 'reason', e.target.value)}
                            className="w-full bg-transparent focus:bg-[#0d0f12] border border-transparent focus:border-[#1e2330] hover:border-[#1e2330] rounded p-1 text-xs text-[#94a3b8] focus:text-[#f8fafc] resize-none"
                            rows="2"
                            disabled={isInspecting}
                          />
                        </td>
                        <td className="py-4 px-3 text-center">
                          {rec.chartData ? (
                            <div className="relative group inline-block">
                              <span className="text-emerald-400 cursor-pointer text-xs font-bold hover:underline">
                                查看截圖
                              </span>
                              <div className="absolute bottom-6 right-0 scale-0 group-hover:scale-100 transition-all origin-bottom-right z-50 p-2 bg-[#0d0f12] border border-[#1e2330] rounded-lg shadow-2xl w-64">
                                <img src={rec.chartData} alt="analysis" className="w-full rounded" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#64748b] text-xs">無圖檔</span>
                          )}
                        </td>
                        <td className="py-4 px-3 text-center">
                          <button 
                            onClick={() => deleteRecord(rec.id)}
                            className="text-xs text-rose-500 hover:text-rose-400 font-bold disabled:opacity-30"
                            disabled={isInspecting}
                          >
                            刪除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* 3. PERFORMANCE DASHBOARD SECTION */}
        {activeTab === 'performance' && (
          <div className="space-y-6">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              
              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl" />
                <span className="text-xs font-bold text-[#64748b] block uppercase">常規勝率 (Win Rate)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-4xl font-black text-emerald-400 font-mono">
                    {stats.winRate}%
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2 flex flex-col gap-0.5">
                  <span className="text-[9px] text-amber-400 font-bold">⚠️ 不包含套保對沖單</span>
                  <span>投機勝: <strong className="text-emerald-400">{stats.wins}</strong> / 投機敗: <strong className="text-rose-400">{stats.losses}</strong></span>
                </div>
              </div>

              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 rounded-full blur-2xl" />
                <span className="text-xs font-bold text-[#64748b] block uppercase">套保單統計 (Hedged)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-4xl font-black text-amber-400 font-mono">
                    {stats.totalHedged} <span className="text-xs text-[#64748b]">單</span>
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] mt-2">
                  已平套保: <strong className="text-amber-400">{stats.closedHedged}</strong> 筆
                </div>
              </div>

              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-teal-500/5 rounded-full blur-2xl" />
                <span className="text-xs font-bold text-[#64748b] block uppercase">獲利因子 (Profit Factor)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className={`text-4xl font-black font-mono ${parseFloat(stats.profitFactor) >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {stats.profitFactor}
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] mt-2">毛利 / 毛損比率</div>
              </div>

              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl" />
                <span className="text-xs font-bold text-[#64748b] block uppercase">累計賺取 R 值</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-4xl font-black text-[#60a5fa] font-mono">
                    {stats.totalR} R
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] mt-2">每筆承受風險所累積的效益</div>
              </div>

              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl" />
                <span className="text-xs font-bold text-[#64748b] block uppercase">純利總收益 (Net PnL)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className={`text-4xl font-black font-mono ${parseFloat(stats.actualPnLSum) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {parseFloat(stats.actualPnLSum) >= 0 ? '+' : ''}${stats.actualPnLSum}
                  </span>
                </div>
                <div className="text-[11px] text-[#64748b] mt-2">帳戶變動基準 (包含套保摩擦損益)</div>
              </div>

            </div>

            {/* Performance Equity Line Chart */}
            <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#1e2330] pb-4">
                <div>
                  <h3 className="font-bold text-sm uppercase tracking-wider text-[#94a3b8]">
                    {isInspecting ? `💎 學員 [${activeMemberConfig.nickname}] 的權益曲線` : '帳戶增長與 R 淨值曲線 (淨獲利模擬)'}
                  </h3>
                  <p className="text-xs text-[#64748b]">實時計算所有實戰平倉盈虧後之權益走向</p>
                </div>
                <div className="text-right text-xs">
                  <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 mr-1.5" />
                  <span className="text-[#94a3b8] font-bold">資產餘額: ${chartPoints[chartPoints.length - 1].balance.toFixed(2)} USDT</span>
                </div>
              </div>

              {/* Render Responsive SVG Chart */}
              <div className="h-[280px] w-full pt-4 relative">
                {!chartVisualData ? (
                  <div className="h-full w-full flex items-center justify-center text-[#64748b] text-sm">
                    需要至少 1 筆以上的完成交易記錄才能繪製權益曲線圖
                  </div>
                ) : (
                  <svg className="w-full h-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Background Grid Lines */}
                    {[0, 1, 2, 3, 4].map((i) => (
                      <line 
                        key={i}
                        x1="0" 
                        y1={60 * i} 
                        x2="1000" 
                        y2={60 * i} 
                        stroke="#1e2330" 
                        strokeWidth="1" 
                        strokeDasharray="4 4"
                      />
                    ))}

                    <polygon points={chartVisualData.areaStr} fill="url(#chart-glow)" />

                    <polyline 
                      fill="none" 
                      stroke="#10b981" 
                      strokeWidth="3.5" 
                      points={chartVisualData.pointsStr} 
                      strokeLinecap="round"
                    />

                    {chartVisualData.points.map((p) => (
                      <g key={p.idx} className="group cursor-pointer">
                        <circle 
                          cx={p.x} 
                          cy={p.y} 
                          r="5" 
                          fill="#0d0f12" 
                          stroke="#10b981" 
                          strokeWidth="2.5" 
                        />
                        <title>{`餘額: $${p.pt.balance.toFixed(2)} | 時間: ${p.pt.date}`}</title>
                      </g>
                    ))}
                  </svg>
                )}
              </div>

              <div className="flex justify-between text-[10px] text-[#64748b] font-mono">
                <span>起點: 初始設定餘額</span>
                <span>終點: 最新平倉點</span>
              </div>
            </div>

            {/* Strategy & Asset & Psychological break downs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Asset Effectiveness Card */}
              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl space-y-4">
                <h3 className="font-bold text-sm uppercase tracking-wider text-[#94a3b8]">幣種戰績分析</h3>
                <div className="space-y-3">
                  {Object.keys(stats.coinStats).length === 0 ? (
                    <p className="text-xs text-[#64748b]">尚無數據</p>
                  ) : (
                    Object.entries(stats.coinStats).map(([coin, data]) => {
                      const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
                      return (
                        <div key={coin} className="bg-[#141822] p-3 rounded-xl border border-[#1e2330] flex items-center justify-between">
                          <div>
                            <span className="font-bold text-sm text-[#f8fafc]">{coin}/USDT</span>
                            <span className="text-[10px] text-[#64748b] block">投機交易數: {data.count} | 套保對沖: {data.hedgedCount}</span>
                          </div>
                          
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <span className="text-xs text-[#64748b] block">常規勝率</span>
                              <span className="text-sm font-bold text-emerald-400">{winRate.toFixed(1)}%</span>
                            </div>
                            <div className="text-right">
                              <span className="text-xs text-[#64748b] block">累計收益</span>
                              <span className={`text-sm font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                              </span>
                            </div>
                          </div>