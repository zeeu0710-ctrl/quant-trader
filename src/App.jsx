import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
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
  signOut,
  updatePassword
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
// HELPER FUNCTIONS FOR LOCAL DATE & TIME INITIALIZATION
// ============================================================================
const getLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLocalTimeString = () => {
  const d = new Date();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// ============================================================================
// FIREBASE CONFIG & INITIALIZATION (SECURE & CUSTOMIZED TO YOUR PROJECT)
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyBldG08UeCwPCiOcHq6ylnDAxlpp-CTDEU",
      authDomain: "quanttrader-pro-d4888.firebaseapp.com",
      projectId: "quanttrader-pro-d4888",
      storageBucket: "quanttrader-pro-d4888.firebasestorage.app",
      messagingSenderId: "300426681383",
      appId: "1:300426681383:web:2215904de28dcb458f8202",
      measurementId: "G-Z5Q39JL7V4"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'quanttrader-pro-d4888';
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

  // Change Password States
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Create Staff Account States (Used by Owner)
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffNickname, setStaffNickname] = useState('');
  const [staffRole, setStaffRole] = useState('admin'); // admin, viewer, member
  const [staffLoading, setStaffLoading] = useState(false);

  // Custom UI Modals (Replaces native blocking alerts/confirm)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmMigrationData, setConfirmMigrationData] = useState(null);

  // Private Member Account Configuration (Private Sandbox space)
  const [memberConfig, setMemberConfig] = useState({
    nickname: '頂級交易員',
    defaultRiskCapital: 10000,
    baseCurrency: 'USDT',
    role: 'member' // Default role - dynamically synced/elevated via DB
  });

  // Global Settings State (Admin editable, synced globally)
  const [globalSettings, setGlobalSettings] = useState({
    makerFee: 0.02, // BingX Maker fee %
    takerFee: 0.05, // BingX Taker fee %
    coins: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'BNB', 'ORDI', 'PEPE', 'SUI', 'TAO'],
    timeframes: ['3分鐘', '15分鐘', '1小時', '4小時', '1日'],
    strategies: ['Fibo+關鍵水平位支撐', 'SMC 訂單塊回測+流動性清算', 'EMA 均線過度偏離修正', '突破盤整區追單', '套保對沖（Hedged）']
  });

  // Temp state to allow edits in admin tab before saving/publishing
  const [editingGlobal, setEditingGlobal] = useState({ ...globalSettings });
  const [newCoinInput, setNewCoinInput] = useState('');
  const [newStrategyInput, setNewStrategyInput] = useState('');

  // All Users Directory (For Admin/Owner inspection & Role assignments)
  const [usersDirectory, setUsersDirectory] = useState([]);
  
  // The User UID currently active in the workspace panels
  const [viewingUid, setViewingUid] = useState(null);
  const [inspectedMemberConfig, setInspectedMemberConfig] = useState(null);

  // ============================================================================
  // RBAC RESOLVERS (Direct Account Login Role Determination)
  // ============================================================================
  const currentUserRole = useMemo(() => {
    if (!user) return 'member';
    
    // 🛡️ Hardcoded Owner Account (Configured as zeeu0710@gmail.com / zeeu0710@gamil.com)
    if (user.email === 'zeeu0710@gmail.com' || user.email === 'zeeu0710@gamil.com') return 'owner';
    if (user.email === 'coach@quanttrader.pro') return 'admin';
    if (user.email === 'viewer@quanttrader.pro') return 'viewer';
    
    // Dynamic role resolving from Firestore Directory
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
      strategy: 'SMC 訂單塊回測+流動性清算',
      tpReached: '是',
      slHit: '否',
      hedged: '否',
      riskCoeff: '1.0',
      confidence: 9,
      expectedR: 4.80,
      actualR: 4.80,
      plannedPnL: 480.00,
      actualPnL: 480.00,
      winLoss: '✅ 勝',
      reason: '4H 訂單塊重合 Fibo 0.618，1H 清算掃蕩後果斷切入，第一止盈位精準平倉80%，保本放飛剩餘20%。',
      chartData: '',
      perfChartData: '',
      mistakeTag: '無犯錯 (嚴格執行計畫) ✅'
    },
    {
      id: 'init-2',
      date: '2026-05-26',
      time: '14:20',
      coin: 'SOL',
      timeframe: '15分鐘',
      direction: '多',
      strategy: 'EMA 均線過度偏離修正',
      tpReached: '否',
      slHit: '是',
      hedged: '否',
      riskCoeff: '1.0',
      confidence: 7,
      expectedR: 3.20,
      actualR: -1.05,
      plannedPnL: 320.00,
      actualPnL: -105.00,
      winLoss: '❌ 敗',
      reason: '15M 出現假突破，急於切入未等 K 線收盤確認。觸發止損並扣除雙邊 Taker 手續費摩擦。',
      chartData: '',
      perfChartData: '',
      mistakeTag: 'FOMO (恐慌性追高/空) 😱'
    }
  ]);

  // Trade Planner State (Timeframe custom list + SL Renaming + Risk Auto-sizing + Custom Date/Time)
  const [planner, setPlanner] = useState({
    coin: 'BTC',
    timeframe: '1小時',
    direction: '多', 
    entryPrice: 68000,
    orderValue: 10000, 
    stopLossPrice: 67000,
    strategy: 'SMC 訂單塊回測+流動性清算',
    confidence: 8,
    riskCoeff: 1.0,
    reason: '',
    screenshot: '',
    hedged: '否', 
    mistakeTag: '無犯錯 (嚴格執行計畫) ✅',
    useSmartSizing: false, 
    riskAmount: 100, // Capital at risk per trade (R)
    leverageSizing: 20, // Slider for margin estimation
    date: getLocalDateString(), // User customizable open date
    time: getLocalTimeString(), // User customizable open time
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
        
        // Auto assign profile role based on email on login/auth state change
        let resolvedRole = 'member';
        if (currentUser.email === 'zeeu0710@gmail.com' || currentUser.email === 'zeeu0710@gamil.com') resolvedRole = 'owner';
        else if (currentUser.email === 'coach@quanttrader.pro') resolvedRole = 'admin';
        else if (currentUser.email === 'viewer@quanttrader.pro') resolvedRole = 'viewer';

        registerUserInDirectory(currentUser.uid, currentUser.email, memberConfig.nickname, resolvedRole);
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
        roleToSave = snap.data().role; // Respect existing DB assignments over defaults
      }
      
      const updatePayload = {
        uid,
        email: email || '匿名訪客',
        nickname: nickname || '頂級交易員',
        role: roleToSave,
        updatedAt: new Date().toISOString()
      };

      await setDoc(dirRef, updatePayload, { merge: true });
      
      // Update local state if updating self
      if (uid === auth.currentUser?.uid) {
        setMemberConfig(prev => ({ ...prev, role: roleToSave }));
      }
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
        if (user.email === 'zeeu0710@gmail.com' || user.email === 'zeeu0710@gamil.com' || currentUserRole === 'owner') {
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

  // F. 👑 Owner Action: Create New Admin/Staff Account (Information Engineer Workaround)
  const handleCreateStaffAccount = async (e) => {
    e.preventDefault();
    if (!isOwner) {
      showToast("安全防線：只有擁有者（Owner）具備建立團隊管理人員的權限！", "error");
      return;
    }
    if (!staffEmail || !staffPassword || !staffNickname) {
      showToast("請填寫完整的工作人員帳密與暱稱！", "warning");
      return;
    }
    if (staffPassword.length < 6) {
      showToast("密碼長度必須大於 6 個字元！", "warning");
      return;
    }

    setStaffLoading(true);
    let secondaryApp = null;
    try {
      // 💡 Engineer logic: Initialize a dynamic secondary App so it doesn't log out current Owner session
      const secondaryAppName = `Secondary-Staff-Creator-${Date.now()}`;
      secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      // Create credential on secondary auth instance
      const credential = await createUserWithEmailAndPassword(secondaryAuth, staffEmail, staffPassword);
      const newUid = credential.user.uid;

      // Send verification email to the newly created manager
      await sendEmailVerification(credential.user);

      // Instantly sign out of the secondary auth session
      await signOut(secondaryAuth);

      // Register the new user in public directory and provision default profile
      const dirRef = doc(db, 'artifacts', appId, 'public', 'data', 'users_directory', newUid);
      await setDoc(dirRef, {
        uid: newUid,
        email: staffEmail,
        nickname: staffNickname,
        role: staffRole,
        updatedAt: new Date().toISOString()
      });

      // Write private sandbox space config for them
      const privateConfigRef = doc(db, 'artifacts', appId, 'users', newUid, 'trading_config', 'main');
      await setDoc(privateConfigRef, {
        records: [],
        memberConfig: {
          nickname: staffNickname,
          defaultRiskCapital: 10000,
          baseCurrency: 'USDT',
          role: staffRole
        },
        updatedAt: new Date().toISOString()
      });

      showToast(`🎉 成功建立 ${staffRole.toUpperCase()} 帳號並已發送驗證信！`, "success");
      setStaffEmail('');
      setStaffPassword('');
      setStaffNickname('');
    } catch (err) {
      console.error(err);
      showToast(`建立新管理帳號失敗: ${err.message}`, "error");
    } finally {
      if (secondaryApp) {
        await deleteApp(secondaryApp).catch(console.error);
      }
      setStaffLoading(false);
    }
  };

  // ============================================================================
  // ADVANCED AUTHENTICATION FLOWS (EMAIL & GOOGLE AUTH)
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
      showToast("Google 登入在嵌入式沙盒中因安全限制受阻，請直接使用信箱註冊/登入！", "warning");
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
      showToast("發送郵件失敗，請稍候再試", "error");
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
      await signInAnonymously(auth);
      showToast("已安全登出帳號，返回訪客模式", "info");
    } catch (err) {
      showToast("登出失敗", "error");
    }
  };

  // Secure Password Update Handler
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      showToast("新密碼長度必須至少為 6 個字元！", "warning");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast("兩次輸入的新密碼不一致！", "error");
      return;
    }
    setIsChangingPassword(true);
    try {
      await updatePassword(auth.currentUser, newPassword);
      showToast("🔑 密碼變更成功！請牢記您的新密碼", "success");
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      console.error(err);
      showToast(`密碼變更失敗: ${err.message}`, "error");
    } finally {
      setIsChangingPassword(false);
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
  // PROFESSIONAL MISTAKE LOGGER DEFINITIONS (Trading Mindset & Psychology)
  // ============================================================================
  const mistakeOptions = [
    '無犯錯 (嚴格執行計畫) ✅',
    'FOMO (恐慌性追高/空) 😱',
    '報復性交易 (急於翻本超額加倉) 😡',
    '提前手動止盈 (抗壓不足拿不住) 🏃',
    '手動放寬止損線 (致命凹單僥倖心) 💀',
    '過度交易 (缺乏高勝率訊號頻繁開倉) 🌀',
    '未看清大時區趨勢 (盲目逆勢交易) ⚠️',
    '不合規重倉 (倉位管理崩潰) 🚫'
  ];

  // ============================================================================
  // PROFESSIONAL POSITION SIZING LOGIC & VERIFIABLE MATH DETAILS (BingX Centric)
  // ============================================================================
  const sizingReport = useMemo(() => {
    const { entryPrice, stopLossPrice, riskAmount, leverageSizing } = planner;
    if (!entryPrice || !stopLossPrice || entryPrice === stopLossPrice || !riskAmount) {
      return { 
        slPct: 0, openFeeRate: 0, closeFeeRate: 0, totalFeeRate: 0, 
        recommendedSizing: 0, estimatedMargin: 0 
      };
    }
    
    // 1. SL Distance Pct
    const slPct = Math.abs(entryPrice - stopLossPrice) / entryPrice;
    
    // 2. Both side Taker Friction fee percent (Open & Close are both Market-triggered under SL)
    const openFeeRate = globalSettings.takerFee / 100;
    const closeFeeRate = globalSettings.takerFee / 100; // Under extreme SL triggers, taker fee is applied
    const totalFeeRate = openFeeRate + closeFeeRate;
    
    // 3. Recommended Order Value
    // Formula: OrderValue = RiskAmount / (SL_Distance_Pct + TotalFeeRate)
    const recommendedSizing = riskAmount / (slPct + totalFeeRate);
    
    // 4. Estimated Margin (Required Balance)
    // Formula: Margin = OrderValue / Leverage
    const estimatedMargin = recommendedSizing / leverageSizing;

    return {
      slPct: parseFloat((slPct * 100).toFixed(4)), 
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

    const openFeeRate = globalSettings.takerFee / 100; // Taker Open
    const closeFeeRate = globalSettings.makerFee / 100; // Maker TP
    const closeSLFeeRate = globalSettings.takerFee / 100; // Taker SL

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

    const formattedCoin = (planner.coin || 'BTC').trim().toUpperCase();

    const newRecord = {
      id: 'trade-' + Date.now(),
      date: planner.date || getLocalDateString(), // Fully customizable
      time: planner.time || getLocalTimeString(), // Fully customizable
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
  // CSV FILE IMPORT / EXPORT ENGINE
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
      rec.reason ? rec.reason.replace(/,/g, '，').replace(/\n/g, ' ') : '',
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

    // 💡 Prevent string concatenation error on setting initial capital
    const baseCapital = parseFloat(activeMemberConfig?.defaultRiskCapital) || 10000;
    let currentBalance = baseCapital;
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
  }, [records, activeMemberConfig]);

  // Optimized SVG Line Chart
  const chartVisualData = useMemo(() => {
    if (chartPoints.length <= 1) return null;
    const maxBalance = Math.max(...chartPoints.map(p => p.balance)) * 1.05;
    const minBalance = Math.min(...chartPoints.map(p => p.balance)) * 0.95;
    const range = maxBalance - minBalance || 1000;
    
    const widthInterval = 1000 / (chartPoints.length - 1);
    const points = chartPoints.map((pt, idx) => {
      const x = idx * widthInterval;
      const y = 300 - ((pt.balance - minBalance) / range) * 230 - 35; 
      return { x, y, pt, idx };
    });

    const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaStr = `${pointsStr} 1000,300 0,300`;

    return { points, pointsStr, areaStr };
  }, [chartPoints]);

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#e2e8f0] font-sans flex flex-col selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* GLOBAL TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl border transition-all duration-300 ${
          toast.type === 'success' ? 'bg-[#0f241a] border-emerald-500/30 text-emerald-300' :
          toast.type === 'error' ? 'bg-[#240f0f] border-rose-500/30 text-rose-300' :
          'bg-[#201c0c] border-amber-500/30 text-amber-300'
        }`}>
          <div className="w-2 h-2 rounded-full animate-ping bg-current" />
          <span className="font-semibold text-xs tracking-wide">{toast.message}</span>
        </div>
      )}

      {/* ADMIN INSPECTING USER PERSISTENT WARNING BANNER */}
      {isInspecting && (
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-[#0d0f12] px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xl font-bold text-xs sticky top-[73px] z-30 animate-pulse">
          <div className="flex items-center gap-2.5">
            <span className="text-sm">👁️</span>
            <span>
              正在以團隊高階管理者角色，穿透監看學員：
              <span className="bg-[#0d0f12] text-amber-400 px-2 py-0.5 rounded ml-1 font-mono text-xs">
                {activeMemberConfig.nickname}
              </span> 的覆盤終端 (🔒 唯讀模式已自動鎖定，防竄改安全規則生效中)
            </span>
          </div>
          <button 
            onClick={() => {
              if (user) {
                setViewingUid(user.uid);
                setInspectedMemberConfig(null);
                showToast("已安全退出穿透監看模式，回到個人控制終端", "info");
              }
            }}
            className="bg-[#0d0f12] hover:bg-[#151c2a] text-amber-400 border border-amber-500/30 px-4 py-1.5 rounded-lg text-[10px] font-black tracking-wide transition-colors"
          >
            退出監看 🚪
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
      <header className="sticky top-0 z-40 bg-[#0d0f12]/90 backdrop-blur-md border-b border-[#181d28] px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
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
              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono">
                v10.0
              </span>
            </div>
            <p className="text-xs text-[#64748b]">BingX 合約規劃紀錄＆分析</p>
          </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <nav className="flex items-center gap-1.5 bg-[#10131d] p-1 rounded-xl border border-[#1b212f]">
          <button 
            onClick={() => setActiveTab('planner')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'planner' 
                ? 'bg-[#1b212f] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#141822]'
            }`}
          >
            📈 交易規劃
          </button>
          <button 
            onClick={() => setActiveTab('journal')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'journal' 
                ? 'bg-[#1b212f] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#141822]'
            }`}
          >
            📔 交易紀錄
          </button>
          <button 
            onClick={() => {
              setActiveTab('performance');
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'performance' 
                ? 'bg-[#1b212f] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#141822]'
            }`}
          >
            📊 績效曲線
          </button>
          
          {/* STAFF EXCLUSIVE PORTAL */}
          {isStaff && (
            <button 
              onClick={() => setActiveTab('adminPortal')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all relative ${
                activeTab === 'adminPortal' 
                  ? 'bg-violet-950/40 text-violet-400 border border-violet-500/25 shadow-sm' 
                  : 'text-violet-400/80 hover:text-violet-300 hover:bg-[#141822]'
              }`}
            >
              👑 管理中控
              <span className="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500"></span>
              </span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'settings' 
                ? 'bg-[#1b212f] text-emerald-400 shadow-sm' 
                : 'text-[#94a3b8] hover:text-[#f8fafc] hover:bg-[#141822]'
            }`}
          >
            ⚙️ 帳戶
          </button>
        </nav>

        {/* Realtime Environment Metrics & Auth Controls */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-[#64748b] text-[10px] uppercase tracking-wider">帳戶USDT</span>
            <span className="text-emerald-400 font-bold">
              ${(parseFloat(activeMemberConfig?.defaultRiskCapital) || 10000).toLocaleString()} {activeMemberConfig.baseCurrency}
            </span>
          </div>

          <div className="h-8 w-[1px] bg-[#1a212f] hidden lg:block" />

          {/* User Account State */}
          {user && !user.isAnonymous ? (
            <div className="flex items-center gap-2 bg-[#10131d] border border-[#1b212f] px-3.5 py-1.5 rounded-xl">
              <div className="w-5 h-5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 flex items-center justify-center font-bold text-[#0d0f12] text-[9px]">
                {(memberConfig.nickname ? memberConfig.nickname[0] : (user.email ? user.email[0] : 'U')).toUpperCase()}
              </div>
              <div className="flex flex-col max-w-[110px]">
                <span className="text-[10px] text-emerald-400 font-bold truncate flex items-center gap-1">
                  <span>{memberConfig.nickname || '頂級交易員'}</span>
                  {currentUserRole === 'owner' && <span title="擁有者 (Super)" className="text-violet-400">💎</span>}
                  {currentUserRole === 'admin' && <span title="管理員" className="text-blue-400">🛠️</span>}
                  {currentUserRole === 'viewer' && <span title="檢視教練" className="text-amber-400">👁️</span>}
                </span>
                <span className="text-[#64748b] text-[8px] truncate">{user.email}</span>
              </div>
              <button 
                onClick={handleSignOut}
                className="text-slate-500 hover:text-rose-400 ml-1.5 font-bold transition-colors text-[10px]"
                title="安全退登終端"
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
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-[#0d0f12] font-black px-4 py-2 rounded-xl transition-all shadow-md shadow-emerald-950/20"
            >
              🔑 登入終端
            </button>
          )}
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">

        {/* 1. TRADE PLANNER SECTION */}
        {activeTab === 'planner' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
            
            {/* Left Side: Parameters Inputs */}
            <div className="lg:col-span-7 bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 space-y-6 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-[#1b212f] pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">📐</span>
                  <h2 className="text-base font-bold">
                    {isInspecting ? `監看中：${activeMemberConfig.nickname} 的計畫配置` : 'BingX 永續合約開單規劃'}
                  </h2>
                </div>
                <div className="flex gap-1 bg-[#0a0c10] p-1 rounded-lg border border-[#1b212f]">
                  <button 
                    onClick={() => handlePlannerChange('direction', '多')}
                    className={`px-3.5 py-1.5 rounded-md text-[10px] font-bold tracking-wider transition-all ${
                      planner.direction === '多' 
                        ? 'bg-emerald-500 text-[#0d0f12]' 
                        : 'text-[#94a3b8] hover:text-[#f8fafc]'
                    }`}
                    disabled={isInspecting}
                  >
                    BUY / 多單
                  </button>
                  <button 
                    onClick={() => handlePlannerChange('direction', '空')}
                    className={`px-3.5 py-1.5 rounded-md text-[10px] font-bold tracking-wider transition-all ${
                      planner.direction === '空' 
                        ? 'bg-rose-500 text-[#f8fafc]' 
                        : 'text-[#94a3b8] hover:text-[#f8fafc]'
                    }`}
                    disabled={isInspecting}
                  >
                    SELL / 空單
                  </button>
                </div>
              </div>

              {/* Calculator Parameters Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Custom Coin Input & Dropdown Integrator */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">交易標的 (幣種)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      list="coins-datalist"
                      value={planner.coin}
                      onChange={(e) => handlePlannerChange('coin', e.target.value.toUpperCase())}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                      placeholder="輸入或選擇 (如 BTC/TAO)"
                      disabled={isInspecting}
                    />
                    <datalist id="coins-datalist">
                      {globalSettings.coins.map(c => <option key={c} value={c}>{c}</option>)}
                    </datalist>
                  </div>
                </div>

                {/* Timeframe Input with Datalist */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">分析級別 (Timeframe)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      list="timeframes-datalist"
                      value={planner.timeframe}
                      onChange={(e) => handlePlannerChange('timeframe', e.target.value)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                      placeholder="自訂或選擇 (如 12分鐘)"
                      disabled={isInspecting}
                    />
                    <datalist id="timeframes-datalist">
                      {globalSettings.timeframes.map(t => <option key={t} value={t}>{t}</option>)}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    預計開倉點位 (Entry Price)
                  </label>
                  <div className="relative font-mono">
                    <input 
                      type="number" 
                      value={planner.entryPrice}
                      onChange={(e) => handlePlannerChange('entryPrice', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl pl-3.5 pr-12 py-2.5 text-xs font-bold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="0.00"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-[9px] font-bold text-[#64748b]">USDT</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    SL (止損線)
                  </label>
                  <div className="relative font-mono">
                    <input 
                      type="number" 
                      value={planner.stopLossPrice}
                      onChange={(e) => handlePlannerChange('stopLossPrice', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl pl-3.5 pr-12 py-2.5 text-xs font-bold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="SL 價格"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-[9px] font-bold text-[#64748b]">USDT</span>
                  </div>
                </div>

                {/* BingX Position/Order Value */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    BingX 訂單價值 (Order Value)
                  </label>
                  <div className="relative font-mono">
                    <input 
                      type="number" 
                      value={planner.orderValue}
                      onChange={(e) => handlePlannerChange('orderValue', parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl pl-3.5 pr-12 py-2.5 text-xs font-bold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="槓桿 x 保證金的總價值"
                      disabled={isInspecting}
                    />
                    <span className="absolute right-3.5 top-2.5 text-[9px] font-bold text-[#64748b]">USDT</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">開單信心度</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="10" 
                      value={planner.confidence}
                      onChange={(e) => handlePlannerChange('confidence', parseInt(e.target.value) || 5)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-bold text-amber-400 focus:outline-none font-mono text-center"
                      disabled={isInspecting}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">自訂風險係數 (R)</label>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={planner.riskCoeff}
                      onChange={(e) => handlePlannerChange('riskCoeff', parseFloat(e.target.value) || 1.0)}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-bold text-emerald-400 focus:outline-none font-mono text-center"
                      disabled={isInspecting}
                    />
                  </div>
                </div>

                {/* 🏆 USER INPUT: TRADE OPEN DATE */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    開倉日期 (Date)
                  </label>
                  <input 
                    type="date" 
                    value={planner.date}
                    onChange={(e) => handlePlannerChange('date', e.target.value)}
                    className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                    disabled={isInspecting}
                  />
                </div>

                {/* 🏆 USER INPUT: TRADE OPEN TIME */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">
                    開倉時間 (Time)
                  </label>
                  <input 
                    type="time" 
                    value={planner.time}
                    onChange={(e) => handlePlannerChange('time', e.target.value)}
                    className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                    disabled={isInspecting}
                  />
                </div>

              </div>

              {/* R-Risk Position Sizing Module */}
              <div className="p-4.5 bg-[#0a0c10] rounded-xl border border-emerald-500/10 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <span>🛡️</span> 訂單價值算倉
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={planner.useSmartSizing} 
                      onChange={(e) => handlePlannerChange('useSmartSizing', e.target.checked)}
                      className="sr-only peer"
                      disabled={isInspecting}
                    />
                    <div className="w-8 h-4.5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-[#0a0c10] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {planner.useSmartSizing && (
                  <div className="space-y-4 animate-slideDown">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-[9px] text-[#94a3b8] mb-1.5 uppercase font-bold tracking-wider">
                          單筆最大容許損失
                        </label>
                        <div className="relative font-mono">
                          <input 
                            type="number" 
                            value={planner.riskAmount} 
                            onChange={(e) => handlePlannerChange('riskAmount', parseFloat(e.target.value) || 0)}
                            className="w-full bg-[#11141c] border border-[#1b212f] rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 font-bold"
                            disabled={isInspecting}
                          />
                          <span className="absolute right-2 top-1.5 text-[8px] font-bold text-[#64748b]">USDT</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] text-[#94a3b8] mb-1.5 uppercase font-bold tracking-wider">
                          預計合約槓桿: <span className="text-amber-400 font-mono font-bold">{planner.leverageSizing}x</span>
                        </label>
                        <input 
                          type="range"
                          min="1"
                          max="150"
                          value={planner.leverageSizing}
                          onChange={(e) => handlePlannerChange('leverageSizing', parseInt(e.target.value) || 20)}
                          className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-[#11141c] rounded-lg appearance-none"
                          disabled={isInspecting}
                        />
                      </div>

                      <div>
                        <button
                          onClick={() => {
                            if (sizingReport.recommendedSizing > 0) {
                              handlePlannerChange('orderValue', sizingReport.recommendedSizing);
                              showToast(`已成功導入建議訂單價值：$${sizingReport.recommendedSizing.toLocaleString()} USDT`, "success");
                            } else {
                              showToast("請先輸入有效的開倉點位、SL 與最大承受損失", "warning");
                            }
                          }}
                          disabled={isInspecting || sizingReport.recommendedSizing <= 0}
                          className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 py-1.5 rounded-lg text-[10px] font-black transition-all disabled:opacity-30"
                        >
                          ⚡ 載入計算值
                        </button>
                      </div>
                    </div>

                    {/* Step-by-Step Verifiable Math Breakdown Cards */}
                    <div className="bg-[#11141c]/60 rounded-lg p-3 border border-[#1b212f] space-y-2 text-[11px] font-mono">
                      <div className="text-slate-400 font-bold border-b border-[#1b212f] pb-1 flex justify-between">
                        <span>🧮 算倉推導公式一覽</span>
                        <span className="text-emerald-400 text-[10px]">自動扣除雙邊 Taker 損耗</span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-500">1. 到止損點價差:</span>{' '}
                          <span className="text-[#f8fafc] font-bold">{sizingReport.slPct}%</span>
                        </div>
                        <div>
                          <span className="text-slate-500">2. 雙邊吃單總費率:</span>{' '}
                          <span className="text-[#f8fafc] font-bold">{sizingReport.totalFeeRate}%</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-slate-500">3. 建議 BingX 訂單價值:</span>{' '}
                          <span className="text-emerald-400 font-black">${sizingReport.recommendedSizing.toLocaleString()} USDT</span>
                        </div>
                        <div className="sm:col-span-2 border-t border-[#1b212f]/40 pt-1 flex justify-between">
                          <span className="text-slate-500">👉 估計保證金 (Margin) 需儲備:</span>{' '}
                          <span className="text-amber-400 font-black">${sizingReport.estimatedMargin.toLocaleString()} USDT ({planner.leverageSizing}x)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {!planner.useSmartSizing && (
                  <p className="text-[10px] text-slate-500">
                    💡 智能算倉可在開單前將 **SL 百分比** 與 **雙邊吃單費率（0.1%）** 整合，精確計算出保證金與槓桿配比，把真實損失控制在您設定的 R 值。
                  </p>
                )}
              </div>

              {/* Multi-TP Configuration Section */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
                    分批止盈減倉策略 (Multi-TP Exit)
                  </label>
                  <span className="text-[10px] font-semibold text-[#64748b]">
                    已設定平倉比例: {planner.tps.reduce((acc, curr) => acc + (curr.active ? curr.percent : 0), 0)}%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {planner.tps.map((tp) => (
                    <div 
                      key={tp.id} 
                      className={`p-3 rounded-xl border transition-all ${
                        tp.active 
                          ? 'bg-[#0a0c10] border-emerald-500/10' 
                          : 'bg-[#0a0c10]/40 border-[#1b212f]/40 opacity-40'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-emerald-400">TP {tp.id}</span>
                        <button 
                          onClick={() => toggleTpActive(tp.id)}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                            tp.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                          }`}
                          disabled={isInspecting}
                        >
                          {tp.active ? '已啟用' : '未啟用'}
                        </button>
                      </div>

                      {tp.active && (
                        <div className="flex gap-2.5 font-mono">
                          <div className="flex-1">
                            <label className="block text-[8px] text-[#64748b] mb-1">平倉價格</label>
                            <input 
                              type="number" 
                              value={tp.price || ''}
                              onChange={(e) => handleTpChange(tp.id, 'price', parseFloat(e.target.value) || 0)}
                              className="w-full bg-[#11141c] border border-[#1b212f] rounded-lg px-2.5 py-1 text-xs text-[#f8fafc] font-bold"
                              placeholder="0.00"
                              disabled={isInspecting}
                            />
                          </div>
                          <div className="w-20">
                            <label className="block text-[8px] text-[#64748b] mb-1">減倉比例</label>
                            <input 
                              type="number" 
                              value={tp.percent || ''}
                              onChange={(e) => handleTpChange(tp.id, 'percent', parseInt(e.target.value) || 0)}
                              className="w-full bg-[#11141c] border border-[#1b212f] rounded-lg px-2.5 py-1 text-xs text-center text-[#f8fafc] font-bold"
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
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">開單策略</label>
                  <select 
                    value={planner.strategy}
                    onChange={(e) => handlePlannerChange('strategy', e.target.value)}
                    className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    {globalSettings.strategies.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">套保性質單 (Hedged)</label>
                  <select 
                    value={planner.hedged}
                    onChange={(e) => handlePlannerChange('hedged', e.target.value)}
                    className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    <option value="否">否 (計入常規覆盤勝率)</option>
                    <option value="是">是 (對沖套保不計勝率)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">心態與偏差歸因</label>
                  <select 
                    value={planner.mistakeTag}
                    onChange={(e) => handlePlannerChange('mistakeTag', e.target.value)}
                    className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                    disabled={isInspecting}
                  >
                    {mistakeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </div>

              {/* Upload Screenshot preview card inside Planner */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">實戰 K 線/關鍵支撐阻力圖檔</label>
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
                    className="flex-1 bg-[#0a0c10] hover:bg-[#11141c] border border-[#1b212f] rounded-xl px-3.5 py-2 text-xs font-semibold text-[#e2e8f0] transition-colors"
                    disabled={isInspecting}
                  >
                    {screenshotPreview ? '📸 已加載圖檔' : '📁 選擇 K 線或覆盤分析截圖...'}
                  </button>
                  {screenshotPreview && (
                    <button 
                      onClick={clearScreenshot}
                      className="bg-rose-950/40 border border-rose-500/20 text-rose-400 px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-rose-900/50"
                      disabled={isInspecting}
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1.5">開單備忘錄 (Entry Reason)</label>
                <textarea 
                  value={planner.reason}
                  onChange={(e) => handlePlannerChange('reason', e.target.value)}
                  rows="3"
                  className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl p-3.5 text-xs text-[#f8fafc] focus:outline-none focus:border-emerald-500 leading-relaxed"
                  placeholder="詳細記載：失衡區、大時區 4H OB 支撐、15M 流動性清算點..."
                  disabled={isInspecting}
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-4 pt-2">
                <button 
                  onClick={submitPlanToJournal}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-[#0d0f12] font-extrabold py-3.5 px-6 rounded-xl text-xs tracking-wider transition-all shadow-lg shadow-emerald-500/10 disabled:opacity-40"
                  disabled={isInspecting}
                >
                  {isInspecting ? '🔒 穿透監看：唯讀保護中' : '🚀 建立計畫並提交至覆盤日誌'}
                </button>
              </div>

            </div>

            {/* Right Side: Professional Calculations Live Monitor */}
            <div className="lg:col-span-5 space-y-6">
              
              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 space-y-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -z-10" />
                
                <div className="flex items-center justify-between border-b border-[#1b212f] pb-4">
                  <h3 className="font-bold text-[10px] tracking-wider uppercase text-[#64748b]">實時計畫預算模組</h3>
                  <span className="text-[9px] font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                    {planner.hedged === '是' ? '套保對沖隔離' : '常規勝率計入'}
                  </span>
                </div>

                {/* Main Metrics Card */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0a0c10] p-4 rounded-xl border border-[#1b212f]">
                    <span className="text-[9px] font-bold text-[#64748b] block uppercase">預計最優淨盈虧</span>
                    <span className="text-lg font-black text-emerald-400 font-mono block mt-1">
                      +${plannerCalculations.netPlannedPnL.toFixed(2)}
                    </span>
                    <span className="block text-[8px] text-[#64748b] mt-1">(已扣除 Maker 費)</span>
                  </div>

                  <div className="bg-[#0a0c10] p-4 rounded-xl border border-[#1b212f]">
                    <span className="text-[9px] font-bold text-[#64748b] block uppercase">計畫最大淨虧損</span>
                    <span className="text-lg font-black text-rose-400 font-mono block mt-1">
                      -${Math.abs(plannerCalculations.netPnlSL).toFixed(2)}
                    </span>
                    <span className="block text-[8px] text-[#64748b] mt-1">(觸發 SL + Taker 費)</span>
                  </div>
                </div>

                {/* Big Expected R Display */}
                <div className="bg-gradient-to-br from-[#0a0c10] to-[#121622] p-5 rounded-2xl border border-[#1b212f] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-[#94a3b8] block uppercase">預期 R 盈虧比 (R-Value)</span>
                    <p className="text-[8px] text-[#64748b] mt-0.5">每單位風險 (1R) 對應之理論盈虧效益</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-3xl font-extrabold font-mono ${plannerCalculations.expectedR >= 2.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {plannerCalculations.expectedR} R
                    </span>
                  </div>
                </div>

                {/* Professional Fee breakdown logs */}
                <div className="space-y-2.5">
                  <h4 className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">雙邊合約費用摩擦成本估算</h4>
                  
                  <div className="bg-[#0a0c10] p-4 rounded-xl border border-[#1b212f] space-y-2 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">吃單開倉費用 (Taker {globalSettings.takerFee}%):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.openFee.toFixed(2)} USDT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">觸發止損平倉費用 (Taker {globalSettings.takerFee}%):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.closeFeeSL.toFixed(2)} USDT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748b]">計畫止盈平倉費用 (Maker {globalSettings.makerFee}%):</span>
                      <span className="text-[#e2e8f0]">${plannerCalculations.totalCloseFeePlanned.toFixed(2)} USDT</span>
                    </div>
                    <div className="h-[1px] bg-[#1b212f] my-1" />
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-[#94a3b8]">單次交易極限手續費成本:</span>
                      <span className="text-amber-400">
                        ${(plannerCalculations.openFee + Math.max(plannerCalculations.closeFeeSL, plannerCalculations.totalCloseFeePlanned)).toFixed(2)} USDT
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Chart Live Preview Frame */}
              {screenshotPreview && (
                <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-4 shadow-xl backdrop-blur-sm animate-fadeIn">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-[#94a3b8] uppercase">實戰盤面圖檔預覽</span>
                    <button 
                      onClick={clearScreenshot}
                      className="text-[10px] text-rose-400 font-bold hover:underline"
                    >
                      移除
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-[#1b212f] bg-[#0a0c10] relative max-h-[220px] flex items-center justify-center">
                    <img src={screenshotPreview} alt="Chart preview" className="w-full object-cover" />
                  </div>
                </div>
              )}

            </div>

          </div>
        )}

        {/* 2. TRADING JOURNAL TABLE SECTION */}
        {activeTab === 'journal' && (
          <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-6 animate-fadeIn backdrop-blur-sm">
            
            {/* Journal Sub Header Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1b212f] pb-4">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm">📓</span>
                <div>
                  <h2 className="text-base font-bold">
                    {isInspecting ? `💎 正在查閱：${activeMemberConfig.nickname} 的歷史覆盤日誌` : '實戰交易覆盤日誌'}
                  </h2>
                  <p className="text-xs text-[#64748b]">
                    {isInspecting ? '🔒 當前為管理端穿透唯讀模式' : '套保自動從勝率歸因指標中隔離。'}
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
                  className="bg-[#0a0c10] hover:bg-[#141822] border border-[#1b212f] text-emerald-400 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
                  disabled={isInspecting}
                >
                  📥 匯入歷史紀錄 (CSV)
                </button>

                <button 
                  onClick={handleExportCSV}
                  className="bg-emerald-500 hover:bg-emerald-400 text-[#0d0f12] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors"
                >
                  📤 導出數據備份 (CSV)
                </button>
              </div>
            </div>

            {/* High Fidelity Scrollable Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1b212f] text-[10px] uppercase tracking-wider text-[#64748b] font-bold">
                    <th className="py-3 px-4">開倉時間 / 幣種</th>
                    <th className="py-3 px-2">分析級別</th>
                    <th className="py-3 px-2">方向</th>
                    <th className="py-3 px-3">使用策略</th>
                    <th className="py-3 px-2 text-center">TP/SL 觸發</th>
                    <th className="py-3 px-2 text-center">對沖套保</th>
                    <th className="py-3 px-2 text-center">心理覆盤與偏差</th>
                    <th className="py-3 px-2 text-center">信心</th>
                    <th className="py-3 px-3 text-right">預計 R / 實際 R</th>
                    <th className="py-3 px-3 text-right">計畫 / 實際 PnL</th>
                    <th className="py-3 px-3 text-center">勝負結果</th>
                    <th className="py-3 px-4">開倉依據 / 備忘註記</th>
                    <th className="py-3 px-3 text-center">K線圖</th>
                    <th className="py-3 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b212f]/40 text-xs">
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan="14" className="py-12 text-center text-[#64748b] font-medium">
                        目前沒有覆盤紀錄。請先使用規劃器建立新計畫或匯入歷史 CSV 檔案。
                      </td>
                    </tr>
                  ) : (
                    records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-[#10131d]/40 transition-colors">
                        <td className="py-4 px-4">
                          <div className="font-bold text-[#f8fafc]">{rec.coin}/USDT</div>
                          <div className="text-[9px] text-[#64748b] font-mono">{rec.date} {rec.time}</div>
                        </td>
                        <td className="py-4 px-2">
                          <span className="text-[10px] font-semibold bg-[#141822] text-[#94a3b8] px-2 py-0.5 rounded border border-[#1b212f]">
                            {rec.timeframe}
                          </span>
                        </td>
                        <td className="py-4 px-2">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                            rec.direction === '多' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {rec.direction}
                          </span>
                        </td>
                        <td className="py-4 px-3 text-slate-300 font-medium">
                          {rec.strategy}
                        </td>
                        <td className="py-4 px-2">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              rec.tpReached === '開' || rec.tpReached === '是' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-900 text-slate-500'
                            }`}>
                              TP: {rec.tpReached}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              rec.slHit === '是' ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-900 text-slate-500'
                            }`}>
                              SL: {rec.slHit}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-2 text-center">
                          <select 
                            value={rec.hedged || '否'}
                            onChange={(e) => updateRecordField(rec.id, 'hedged', e.target.value)}
                            className={`text-[10px] font-bold rounded px-2 py-0.5 text-center bg-[#0a0c10] border ${
                              rec.hedged === '是' 
                                ? 'border-amber-500/30 text-amber-400 bg-amber-500/5' 
                                : 'border-slate-800 text-slate-400'
                            }`}
                            disabled={isInspecting}
                          >
                            <option value="否">否</option>
                            <option value="是">是</option>
                          </select>
                        </td>
                        <td className="py-4 px-2">
                          <select
                            value={rec.mistakeTag || '無犯錯 (嚴格執行計畫) ✅'}
                            onChange={(e) => updateRecordField(rec.id, 'mistakeTag', e.target.value)}
                            className="text-[10px] bg-[#0a0c10] border border-[#1b212f] rounded p-1 text-[#94a3b8] focus:text-[#f8fafc] max-w-[150px]"
                            disabled={isInspecting}
                          >
                            {mistakeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </td>
                        <td className="py-4 px-2 text-center font-mono font-bold text-amber-400">
                          {rec.confidence}/10
                        </td>
                        <td className="py-4 px-3 text-right font-mono">
                          <div className="text-[#64748b] text-[10px]">預期: <span className="text-[#e2e8f0] font-bold">{rec.expectedR}R</span></div>
                          
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[9px] text-emerald-500 font-bold">實際 R:</span>
                            <input 
                              type="number" 
                              step="0.05"
                              value={rec.actualR}
                              onChange={(e) => updateRecordField(rec.id, 'actualR', parseFloat(e.target.value) || 0)}
                              className="w-14 bg-[#0a0c10] border border-[#1b212f] rounded px-1.5 py-0.5 text-xs text-right font-bold text-emerald-400 font-mono"
                              disabled={isInspecting}
                            />
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right font-mono">
                          <div className="text-[#64748b] text-[10px]">計畫: <span className="text-[#e2e8f0] font-bold">${rec.plannedPnL}</span></div>
                          
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[9px] text-emerald-500 font-bold">$ 實際:</span>
                            <input 
                              type="number" 
                              value={rec.actualPnL}
                              onChange={(e) => updateRecordField(rec.id, 'actualPnL', parseFloat(e.target.value) || 0)}
                              className="w-18 bg-[#0a0c10] border border-[#1b212f] rounded px-1.5 py-0.5 text-xs text-right font-bold text-emerald-400 font-mono"
                              disabled={isInspecting}
                            />
                          </div>
                        </td>
                        <td className="py-4 px-3 text-center">
                          <select 
                            value={rec.winLoss}
                            onChange={(e) => updateRecordField(rec.id, 'winLoss', e.target.value)}
                            className={`text-[10px] font-bold rounded px-1.5 py-0.5 text-center bg-[#0a0c10] border ${
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
                            className="w-full bg-transparent focus:bg-[#0a0c10] border border-transparent focus:border-[#1b212f] hover:border-[#1b212f] rounded p-1 text-[11px] text-[#94a3b8] focus:text-[#f8fafc] resize-y leading-relaxed"
                            rows="2"
                            disabled={isInspecting}
                          />
                        </td>
                        <td className="py-4 px-3 text-center">
                          {rec.chartData ? (
                            <div className="relative group inline-block">
                              <span className="text-emerald-400 cursor-pointer text-[10px] font-bold hover:underline">
                                查看盤面
                              </span>
                              <div className="absolute bottom-6 right-0 scale-0 group-hover:scale-100 transition-all origin-bottom-right z-50 p-2 bg-[#0a0c10] border border-[#1b212f] rounded-lg shadow-2xl w-64">
                                <img src={rec.chartData} alt="analysis" className="w-full rounded" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#64748b] text-[10px]">無圖檔</span>
                          )}
                        </td>
                        <td className="py-4 px-3 text-center">
                          <button 
                            onClick={() => deleteRecord(rec.id)}
                            className="text-[10px] text-rose-500 hover:text-rose-400 font-bold"
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
          <div className="space-y-6 animate-fadeIn">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              
              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl" />
                <span className="text-[10px] font-bold text-[#64748b] block uppercase">常規勝率 (Win Rate)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black text-emerald-400 font-mono">
                    {stats.winRate}%
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2 flex flex-col gap-0.5">
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">⚠️ 已自動剔除套保單</span>
                  <span>投機勝: <strong className="text-emerald-400">{stats.wins}</strong> / 投機敗: <strong className="text-rose-400">{stats.losses}</strong></span>
                </div>
              </div>

              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 rounded-full blur-2xl" />
                <span className="text-[10px] font-bold text-[#64748b] block uppercase">套保單累計 (Hedged)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black text-amber-400 font-mono">
                    {stats.totalHedged} <span className="text-[10px] text-[#64748b]">單</span>
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2">
                  已結套保對沖: <strong className="text-amber-400">{stats.closedHedged}</strong> 筆
                </div>
              </div>

              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-20 h-20 bg-teal-500/5 rounded-full blur-2xl" />
                <span className="text-[10px] font-bold text-[#64748b] block uppercase">獲利因子 (Profit Factor)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className={`text-3xl font-black font-mono ${parseFloat(stats.profitFactor) >= 2.0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {stats.profitFactor}
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2">總毛利 / 總毛損比率</div>
              </div>

              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl" />
                <span className="text-[10px] font-bold text-[#64748b] block uppercase">累計賺取 R 淨值</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl font-black text-[#60a5fa] font-mono">
                    {stats.totalR} R
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2">扣除費用手續費摩擦後之淨利潤</div>
              </div>

              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl" />
                <span className="text-[10px] font-bold text-[#64748b] block uppercase">實戰純收益 (Net PnL)</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className={`text-3xl font-black font-mono ${parseFloat(stats.actualPnLSum) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {parseFloat(stats.actualPnLSum) >= 0 ? '+' : ''}${stats.actualPnLSum}
                  </span>
                </div>
                <div className="text-[10px] text-[#64748b] mt-2">包含套保摩擦損益後之資產走向</div>
              </div>

            </div>

            {/* Performance Equity Line Chart */}
            <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4 backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-[#1b212f] pb-4">
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[#94a3b8]">
                    {isInspecting ? `💎 學員 [${activeMemberConfig.nickname}] 的實時權益曲線` : '模擬帳戶資產淨值增長曲線'}
                  </h3>
                  <p className="text-[10px] text-[#64748b]">資深資訊工程師量化指標 · 資產本金對應 K 線時序走向圖</p>
                </div>
                <div className="text-right text-xs font-mono">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                  <span className="text-[#94a3b8] font-bold">
                    終端餘額: ${parseFloat(chartPoints[chartPoints.length - 1].balance).toFixed(2)} USDT
                  </span>
                </div>
              </div>

              {/* Render Responsive SVG Chart */}
              <div className="h-[280px] w-full pt-4 relative">
                {!chartVisualData ? (
                  <div className="h-full w-full flex items-center justify-center text-[#64748b] text-xs">
                    需要至少 1 筆以上的覆盤完成交易記錄，系統方可自動繪製實時權益增長曲線
                  </div>
                ) : (
                  <svg className="w-full h-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
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
                        stroke="#1b212f" 
                        strokeWidth="1" 
                        strokeDasharray="4 4"
                      />
                    ))}

                    <polygon points={chartVisualData.areaStr} fill="url(#chart-glow)" />

                    <polyline 
                      fill="none" 
                      stroke="#10b981" 
                      strokeWidth="3" 
                      points={chartVisualData.pointsStr} 
                      strokeLinecap="round"
                    />

                    {chartVisualData.points.map((p) => (
                      <g key={p.idx} className="group cursor-pointer">
                        <circle 
                          cx={p.x} 
                          cy={p.y} 
                          r="4" 
                          fill="#0a0c10" 
                          stroke="#10b981" 
                          strokeWidth="2" 
                        />
                        <title>{`餘額: $${parseFloat(p.pt.balance).toFixed(2)} | 時間: ${p.pt.date}`}</title>
                      </g>
                    ))}
                  </svg>
                )}
              </div>

              <div className="flex justify-between text-[9px] text-[#64748b] font-mono uppercase tracking-wider">
                <span>起點: 初始核心資本本金</span>
                <span>終點: 當前最新平倉淨值</span>
              </div>
            </div>

            {/* Strategy & Asset & Psychological breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Asset Effectiveness Card */}
              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4 backdrop-blur-sm">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#94a3b8]">熱門幣種戰績與對沖統計</h3>
                <div className="space-y-3">
                  {Object.keys(stats.coinStats).length === 0 ? (
                    <p className="text-xs text-[#64748b]">尚無標的統計數據</p>
                  ) : (
                    Object.entries(stats.coinStats).map(([coin, data]) => {
                      const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
                      return (
                        <div key={coin} className="bg-[#0a0c10] p-3 rounded-xl border border-[#1b212f] flex items-center justify-between font-mono">
                          <div>
                            <span className="font-bold text-xs text-[#f8fafc]">{coin}/USDT</span>
                            <span className="text-[9px] text-[#64748b] block mt-0.5">投機交易數: {data.count} | 套保對沖: {data.hedgedCount}</span>
                          </div>
                          
                          <div className="flex items-center gap-4 text-right">
                            <div>
                              <span className="text-[8px] text-[#64748b] block">勝率</span>
                              <span className="text-xs font-bold text-emerald-400">{winRate.toFixed(1)}%</span>
                            </div>
                            <div>
                              <span className="text-[8px] text-[#64748b] block">累計損益</span>
                              <span className={`text-xs font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Strategy Effectiveness Card */}
              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4 backdrop-blur-sm">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#94a3b8]">策略庫量化勝率評估</h3>
                <div className="space-y-3">
                  {Object.keys(stats.strategyStats).length === 0 ? (
                    <p className="text-xs text-[#64748b]">尚無可用策略數據</p>
                  ) : (
                    Object.entries(stats.strategyStats).map(([strategy, data]) => {
                      const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
                      return (
                        <div key={strategy} className="bg-[#0a0c10] p-3 rounded-xl border border-[#1b212f] flex items-center justify-between font-mono">
                          <div className="max-w-[140px] truncate">
                            <span className="font-bold text-xs text-[#f8fafc]" title={strategy}>{strategy}</span>
                            <span className="text-[9px] text-[#64748b] block mt-0.5">累計使用: {data.count} 次</span>
                          </div>

                          <div className="flex items-center gap-4 text-right">
                            <div>
                              <span className="text-[8px] text-[#64748b] block">勝率</span>
                              <span className="text-xs font-bold text-emerald-400">{winRate.toFixed(1)}%</span>
                            </div>
                            <div>
                              <span className="text-[8px] text-[#64748b] block">累計收益</span>
                              <span className={`text-xs font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Psychological/Mistake Audit Analytics */}
              <div className="bg-[#11141d] rounded-2xl border border-[#1e2330] p-6 shadow-xl space-y-4 backdrop-blur-sm">
                <h3 className="font-bold text-xs uppercase tracking-wider text-violet-400 flex items-center gap-1.5">
                  <span>🧠</span> 交易心理學偏差歸因儀
                </h3>
                <p className="text-[9px] text-[#64748b] leading-relaxed">
                  大腦漏洞統計：分析何種心理偏誤（Friction Leaks）正在暗中蠶食您的本金：
                </p>
                <div className="space-y-3">
                  {Object.entries(stats.mistakeStats).map(([tag, data]) => {
                    const isOptimal = tag.includes('無犯錯');
                    return (
                      <div key={tag} className="bg-[#0a0c10] p-2.5 rounded-xl border border-[#1b212f] space-y-1.5 font-mono">
                        <div className="flex justify-between items-center text-xs">
                          <span className={`font-bold text-[11px] ${isOptimal ? 'text-emerald-400' : 'text-amber-400'}`}>{tag}</span>
                          <span className="text-slate-500 text-[9px]">觸犯 {data.count} 次</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-500">此歸因合計損益:</span>
                          <span className={`font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* 4. MEMBER ACCOUNT GENERAL SETTINGS SECTION */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
            
            {/* Left Column: Member Private Settings Form */}
            <div className="lg:col-span-8 bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 space-y-6 shadow-xl backdrop-blur-sm">
              
              <div className="border-b border-[#1b212f] pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold">個人交易員參數設定</h2>
                  <p className="text-xs text-[#64748b]">調整您的私有模擬資本預算與資料本機備份</p>
                </div>
              </div>

              {/* Individual Member Configuration */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
                  <span className="text-emerald-400">👤</span> 1. 偏好設定
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5">暱稱</label>
                    <input 
                      type="text" 
                      value={memberConfig.nickname}
                      onChange={(e) => setMemberConfig(prev => ({ ...prev, nickname: e.target.value }))}
                      className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500"
                      placeholder="自訂交易暱稱"
                      disabled={isInspecting}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5">初始模擬資金額度 (R 本金母數)</label>
                    <div className="relative font-mono">
                      <input 
                        type="number" 
                        value={memberConfig.defaultRiskCapital}
                        onChange={(e) => setMemberConfig(prev => ({ ...prev, defaultRiskCapital: parseInt(e.target.value) || 10000 }))}
                        className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-bold"
                        disabled={isInspecting}
                      />
                      <span className="absolute right-3.5 top-2.5 text-xs font-bold text-[#64748b]">USDT</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button 
                    onClick={() => {
                      savePrivateData(records, memberConfig);
                      showToast("👤 個人帳戶資產與暱稱配置已同步更新！", "success");
                    }}
                    className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
                    disabled={isInspecting}
                  >
                    儲存更新配置
                  </button>
                </div>
              </div>

              {/* Data backup configuration */}
              <div className="space-y-4 pt-4 border-t border-[#1b212f]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
                  <span>💾</span> 2. JSON 導出備份與還原
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    onClick={() => {
                      const dataStr = JSON.stringify({ records, memberConfig, globalSettings }, null, 2);
                      const blob = new Blob([dataStr], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `quanttrader_system_backup_${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      showToast("JSON 系統日誌匯出成功", "success");
                    }}
                    className="bg-[#0a0c10] hover:bg-[#11141c] border border-[#1b212f] text-[#e2e8f0] font-bold py-2.5 rounded-xl text-xs transition-colors"
                  >
                    💾 匯出備份 (.json)
                  </button>

                  <button 
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.json';
                      input.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const r = new FileReader();
                          r.onload = (ev) => {
                            try {
                              const parsed = JSON.parse(ev.target.result);
                              if (parsed.records) setRecords(parsed.records);
                              if (parsed.memberConfig) setMemberConfig(parsed.memberConfig);
                              savePrivateData(parsed.records, parsed.memberConfig);
                              showToast("系統狀態與歷史日誌已完美還原！", "success");
                            } catch (err) {
                              showToast("還原失敗，請檢查備份檔格式", "error");
                            }
                          };
                          r.readAsText(file);
                        }
                      };
                      input.click();
                    }}
                    className="bg-[#0a0c10] hover:bg-[#11141c] border border-[#1b212f] text-amber-400 font-bold py-2.5 rounded-xl text-xs transition-colors"
                  >
                    📂 載入並覆蓋備份 (.json)
                  </button>
                </div>
              </div>

              {/* 🏆 USER ACTION: SECURE PASSWORD RESET CARD */}
              {user && !user.isAnonymous && (
                <div className="space-y-4 pt-4 border-t border-[#1b212f] animate-fadeIn">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
                    <span className="text-amber-400">🔑</span> 3. 變更登入密碼
                  </h3>
                  <form onSubmit={handleUpdatePassword} className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-[10px] text-[#94a3b8] mb-1 uppercase font-bold tracking-wider">輸入新密碼</label>
                      <input 
                        type="password"
                        placeholder="請輸入新密碼 (至少 6 位字元)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#94a3b8] mb-1 uppercase font-bold tracking-wider">再次確認新密碼</label>
                      <input 
                        type="password"
                        placeholder="請再次輸入新密碼以供安全確認"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                        required
                      />
                    </div>
                    <div className="flex justify-end">
                      <button 
                        type="submit"
                        disabled={isChangingPassword}
                        className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/35 px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                      >
                        {isChangingPassword ? '正在更新金鑰...' : '安全變更終端密碼'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

            </div>

            {/* Right Column: Member Profile Card */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 space-y-5 shadow-xl relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -z-10" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-[#94a3b8] border-b border-[#1b212f] pb-3">
                  🛡️ 終端驗證中心
                </h3>

                <div className="flex items-center gap-4 bg-[#0a0c10] p-4 rounded-xl border border-[#1b212f]">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-[#0d0f12] text-sm font-black shadow-md shadow-emerald-950/20">
                    {memberConfig.nickname ? memberConfig.nickname[0].toUpperCase() : 'U'}
                  </div>
                  <div className="space-y-1 truncate flex-1 font-mono">
                    <h4 className="font-bold text-xs text-[#f8fafc] flex items-center gap-1.5">
                      <span>{memberConfig.nickname}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        isOwner ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' :
                        isAdmin ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        isViewer ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {currentUserRole === 'owner' ? '擁有者' :
                         currentUserRole === 'admin' ? '管理員' :
                         currentUserRole === 'viewer' ? '教練檢視' : 'PRO 會員'}
                      </span>
                    </h4>
                    <p className="text-[10px] text-[#64748b] truncate">
                      {user && !user.isAnonymous ? user.email : '訪客 (未同步雲端)'}
                    </p>
                  </div>
                </div>

                {/* Account Details */}
                <div className="bg-[#0a0c10] p-4 rounded-xl border border-[#1b212f] space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#64748b]">系統角色:</span>
                    <span className="text-[#f8fafc] font-bold uppercase">{currentUserRole}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748b]">雲端狀態:</span>
                    <span className={`font-bold ${user?.emailVerified ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {user && !user.isAnonymous ? (user.emailVerified ? '安全驗證已通過' : '⚠️ 信箱未認證') : '離線暫存模式'}
                    </span>
                  </div>
                  <div className="h-[1px] bg-[#1b212f] my-1" />
                  <div className="space-y-1">
                    <span className="text-[9px] text-[#64748b] uppercase tracking-wider">安全 UUID 識別碼</span>
                    <div className="flex items-center bg-[#11141c] px-2 py-1 rounded border border-[#1b212f]">
                      <span className="text-[9px] text-emerald-400 truncate flex-1 font-mono select-all">{user?.uid || 'N/A'}</span>
                      <button onClick={() => copyUidToClipboard(user?.uid || '')} className="text-emerald-400 hover:text-emerald-300 ml-1 text-xs">📋</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {user && user.isAnonymous ? (
                    <button 
                      onClick={() => {
                        setAuthMode('login');
                        setShowAuthModal(true);
                      }}
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 text-[#0d0f12] font-black py-3 rounded-xl text-xs tracking-wider"
                    >
                      🚀 升級雲端帳戶 (防本機遺失)
                    </button>
                  ) : (
                    <button 
                      onClick={handleSignOut}
                      className="w-full bg-[#1b2030] hover:bg-rose-950/20 hover:text-rose-400 border border-[#232b3d] text-slate-400 font-bold py-3 rounded-xl text-xs transition-colors"
                    >
                      🚪 登出當前帳號
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ============================================================================
            5. INDEPENDENT ADMIN PORTAL (EXCLUSIVE TO OWNER, ADMIN, VIEWER)
            ============================================================================ */}
        {activeTab === 'adminPortal' && isStaff && (
          <div className="space-y-6 animate-fadeIn font-sans">
            
            {/* Header Status Bar */}
            <div className="bg-gradient-to-r from-violet-950/20 to-indigo-950/10 border border-violet-500/15 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fadeIn">
              <div>
                <h2 className="text-base font-black tracking-tight text-violet-300 flex items-center gap-2">
                  <span>👑</span> QuantTrader 團隊教練與權限管理中控台
                </h2>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  您目前的帳戶信箱具備安全解鎖的 <span className="text-violet-400 font-bold uppercase">{currentUserRole}</span> 權限（無需依靠金鑰，純由管理者登入認證直達）。
                  在此您可以穿透監看特定學員覆盤日誌、分發全域策略。
                </p>
              </div>
              <div className="bg-violet-950/30 border border-violet-500/20 rounded-xl px-4 py-2 text-xs font-mono">
                <span className="text-slate-400">登錄學員總量:</span>{' '}
                <strong className="text-violet-300 font-bold text-sm">{usersDirectory.length}</strong> 名
              </div>
            </div>

            {/* Core Admin Grid: Parameter Management & Member Directory */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Panel: Member directory list & STAFF CREATION INTERFACE */}
              <div className="lg:col-span-8 space-y-6 animate-fadeIn">
                
                {/* 🛡️ 擁有者專屬：直接創立副管理與教練檢視人員帳號 (Owner Exclusive Account Generator) */}
                {isOwner && (
                  <div className="bg-gradient-to-br from-[#1c1530]/90 to-[#12101e]/95 rounded-2xl border border-violet-500/20 p-6 shadow-xl space-y-4">
                    <div className="border-b border-violet-500/10 pb-3 flex items-center justify-between">
                      <h3 className="font-bold text-xs text-violet-300 flex items-center gap-2 uppercase tracking-wider">
                        <span>🛡️</span> 創立團隊管理幹部 (擁有者特權)
                      </h3>
                      <span className="text-[9px] bg-violet-500/15 text-violet-400 px-2 py-0.5 rounded font-mono font-bold">BYPASS LOGOUT</span>
                    </div>

                    <form onSubmit={handleCreateStaffAccount} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">管理幹部暱稱</label>
                        <input 
                          type="text" 
                          placeholder="例如: 幣聖教練"
                          value={staffNickname}
                          onChange={(e) => setStaffNickname(e.target.value)}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none transition-all"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">指派系統角色</label>
                        <select 
                          value={staffRole}
                          onChange={(e) => setStaffRole(e.target.value)}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-violet-400 focus:outline-none transition-all font-mono"
                        >
                          <option value="admin">副管理人員 (Admin)</option>
                          <option value="viewer">唯讀檢視教練 (Viewer)</option>
                          <option value="member">常規PRO學員 (Member)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">設定登入電子信箱 (Email)</label>
                        <input 
                          type="email" 
                          placeholder="例如: coach@quanttrader.pro"
                          value={staffEmail}
                          onChange={(e) => setStaffEmail(e.target.value)}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none font-mono transition-all"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">設定初始安全密碼</label>
                        <input 
                          type="password" 
                          placeholder="密碼長度需至少 6 位字元"
                          value={staffPassword}
                          onChange={(e) => setStaffPassword(e.target.value)}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none font-mono transition-all"
                          required
                        />
                      </div>

                      <div className="md:col-span-2 flex justify-end pt-2">
                        <button 
                          type="submit"
                          disabled={staffLoading}
                          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-extrabold py-3 px-8 rounded-xl text-xs tracking-wider transition-all disabled:opacity-40 shadow-lg shadow-violet-500/10 flex items-center gap-2"
                        >
                          {staffLoading ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              正在同步雲端安全協定...
                            </>
                          ) : '🚀 建立並安全派發信件憑證'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4">
                  <div className="border-b border-[#1b212f] pb-3 flex items-center justify-between">
                    <h3 className="font-bold text-xs text-[#f8fafc] flex items-center gap-2 uppercase tracking-wider">
                      <span>👥</span> 實戰團隊學員權限與進階分配
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[#1b212f] text-[#64748b] uppercase tracking-wider font-bold">
                          <th className="py-2.5 px-4">學員暱稱 (Nickname)</th>
                          <th className="py-2.5 px-3">信箱 (Email)</th>
                          <th className="py-2.5 px-3">權限配發 (RBAC)</th>
                          <th className="py-2.5 px-4 text-center">穿透式實時監督</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1b212f]/30">
                        {usersDirectory.map((member) => (
                          <tr 
                            key={member.uid} 
                            className={`hover:bg-[#10131d]/50 transition-colors ${
                              viewingUid === member.uid ? 'bg-violet-950/10' : ''
                            }`}
                          >
                            {/* Nickname */}
                            <td className="py-3 px-4 font-bold text-emerald-400 flex items-center gap-1.5">
                              <span>{member.nickname}</span>
                              {member.uid === user?.uid && (
                                <span className="text-[8px] bg-[#1a1f2e] text-slate-400 px-1.5 py-0.5 rounded">您自己</span>
                              )}
                            </td>
                            {/* Email */}
                            <td className="py-3 px-3 text-[#94a3b8]">{member.email}</td>
                            {/* RBAC Role Selector Dropdown */}
                            <td className="py-3 px-3">
                              <select 
                                value={member.role || 'member'}
                                onChange={(e) => changeUserRoleInCloud(member.uid, e.target.value)}
                                disabled={!isOwner || member.uid === user?.uid} // Only OWNER can demote/assign, cannot demote oneself
                                className={`text-[10px] font-bold rounded px-2.5 py-1 bg-[#0a0c10] border ${
                                  member.role === 'owner' ? 'border-violet-500/40 text-violet-400' :
                                  member.role === 'admin' ? 'border-blue-500/40 text-blue-400' :
                                  member.role === 'viewer' ? 'border-amber-500/40 text-amber-400' :
                                  'border-slate-800 text-slate-400'
                                } focus:outline-none`}
                              >
                                <option value="member">PRO 會員 (Member)</option>
                                <option value="viewer">教練檢視 (Viewer)</option>
                                <option value="admin">系統副管 (Admin)</option>
                                <option value="owner">最高權限 (Owner)</option>
                              </select>
                              {!isOwner && (
                                <span className="block text-[8px] text-rose-500/70 mt-1">🔒 唯獨最高管理者可修改</span>
                              )}
                            </td>
                            {/* Inspection Action Trigger */}
                            <td className="py-3 px-4 text-center">
                              {viewingUid === member.uid ? (
                                <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-3 py-1 rounded-lg font-bold text-[9px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                  正在穿透監管中
                                </span>
                              ) : (
                                <button 
                                  onClick={() => {
                                    setViewingUid(member.uid);
                                    showToast(`成功穿透！已載入學員 [${member.nickname}] 的覆盤日記`, "success");
                                  }}
                                  className="bg-[#1a1f2e] hover:bg-amber-500 hover:text-[#0d0f12] text-amber-400 px-3 py-1 rounded-lg font-bold transition-all border border-amber-500/15 text-[10px]"
                                >
                                  👁️ 穿透監看
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* Right Panel: Global parameters and constants */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* 1. Global constants configuration */}
                <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4 backdrop-blur-sm">
                  <div className="border-b border-[#1b212f] pb-3 flex items-center justify-between">
                    <h3 className="font-bold text-[10px] uppercase tracking-wider text-violet-300">
                      全域 BingX 永續費率分發
                    </h3>
                    <span className="text-[8px] text-slate-500 font-mono">管理者限定</span>
                  </div>

                  <div className="space-y-4 font-mono">
                    <div>
                      <label className="block text-[9px] text-[#94a3b8] mb-1.5 uppercase font-bold tracking-wider">掛單費率 (Maker Fee)</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          step="0.001"
                          value={editingGlobal.makerFee}
                          onChange={(e) => setEditingGlobal(prev => ({ ...prev, makerFee: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2 text-xs font-bold text-[#f8fafc] focus:outline-none"
                          disabled={isViewer}
                        />
                        <span className="absolute right-3.5 top-2 text-xs font-bold text-[#64748b]">%</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] text-[#94a3b8] mb-1.5 uppercase font-bold tracking-wider">吃單費率 (Taker / SL Fee)</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          step="0.001"
                          value={editingGlobal.takerFee}
                          onChange={(e) => setEditingGlobal(prev => ({ ...prev, takerFee: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2 text-xs font-bold text-[#f8fafc] focus:outline-none"
                          disabled={isViewer}
                        />
                        <span className="absolute right-3.5 top-2 text-xs font-bold text-[#64748b]">%</span>
                      </div>
                    </div>

                    {!isViewer ? (
                      <button 
                        onClick={() => saveGlobalSettingsDoc(editingGlobal)}
                        className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-black py-2.5 rounded-xl text-xs transition-colors shadow-lg shadow-violet-500/10"
                      >
                        💾 發佈費率修正 (全體實時同步)
                      </button>
                    ) : (
                      <div className="text-center text-[9px] text-amber-500 font-bold bg-amber-500/5 p-2 rounded border border-amber-500/10">
                        🔒 您目前是唯讀檢視教練，不允許更改費率。
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Global Strategy Registry */}
                <div className="bg-[#11141c]/80 rounded-2xl border border-[#1b212f] p-6 shadow-xl space-y-4 backdrop-blur-sm">
                  <div className="border-b border-[#1b212f] pb-3 flex items-center justify-between">
                    <h3 className="font-bold text-[10px] uppercase tracking-wider text-violet-300">
                      常規標的與策略庫維護
                    </h3>
                  </div>

                  <div className="space-y-4">
                    {/* Coin List Tag */}
                    <div className="space-y-2">
                      <label className="block text-[9px] text-[#94a3b8] font-bold uppercase">共用可選幣種</label>
                      <div className="flex flex-wrap gap-1 p-2.5 bg-[#0a0c10] rounded-xl border border-[#1b212f] min-h-[40px]">
                        {editingGlobal.coins.map((coin) => (
                          <span key={coin} className="inline-flex items-center gap-1 bg-[#11141c] text-[10px] font-mono font-bold text-slate-300 px-2 py-0.5 rounded border border-slate-800">
                            {coin}
                            {!isViewer && (
                              <button 
                                onClick={() => {
                                  const updatedCoins = editingGlobal.coins.filter(c => c !== coin);
                                  const nextGlobal = { ...editingGlobal, coins: updatedCoins };
                                  setEditingGlobal(nextGlobal);
                                  saveGlobalSettingsDoc(nextGlobal);
                                }}
                                className="text-rose-500 hover:text-rose-400 font-bold ml-1 text-[9px]"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {!isViewer && (
                        <div className="flex gap-1.5">
                          <input 
                            type="text"
                            placeholder="如: SUI"
                            value={newCoinInput}
                            onChange={(e) => setNewCoinInput(e.target.value.toUpperCase())}
                            className="bg-[#0a0c10] border border-[#1b212f] rounded-lg px-2 py-1 text-xs text-[#f8fafc] focus:outline-none flex-1 font-mono"
                          />
                          <button 
                            onClick={() => {
                              const trim = newCoinInput.trim();
                              if (trim && !editingGlobal.coins.includes(trim)) {
                                const nextGlobal = { ...editingGlobal, coins: [...editingGlobal.coins, trim] };
                                setEditingGlobal(nextGlobal);
                                saveGlobalSettingsDoc(nextGlobal);
                                setNewCoinInput('');
                              }
                            }}
                            className="bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/25 px-3 py-1 rounded-lg text-[9px] font-bold"
                          >
                            ＋ 新增
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Strategies list tags */}
                    <div className="space-y-2">
                      <label className="block text-[9px] text-[#94a3b8] font-bold uppercase">推薦學員使用策略</label>
                      <div className="flex flex-wrap gap-1 p-2.5 bg-[#0a0c10] rounded-xl border border-[#1b212f] min-h-[40px]">
                        {editingGlobal.strategies.map((strat) => (
                          <span key={strat} className="inline-flex items-center gap-1 bg-[#11141c] text-[10px] font-bold text-slate-300 px-2 py-0.5 rounded border border-slate-800">
                            {strat}
                            {!isViewer && (
                              <button 
                                onClick={() => {
                                  const updatedStrats = editingGlobal.strategies.filter(s => s !== strat);
                                  const nextGlobal = { ...editingGlobal, strategies: updatedStrats };
                                  setEditingGlobal(nextGlobal);
                                  saveGlobalSettingsDoc(nextGlobal);
                                }}
                                className="text-rose-500 hover:text-rose-400 font-bold ml-1 text-[9px]"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {!isViewer && (
                        <div className="flex gap-1.5">
                          <input 
                            type="text"
                            placeholder="新突破捕捉法..."
                            value={newStrategyInput}
                            onChange={(e) => setNewStrategyInput(e.target.value)}
                            className="bg-[#0a0c10] border border-[#1b212f] rounded-lg px-2 py-1 text-xs text-[#f8fafc] focus:outline-none flex-1"
                          />
                          <button 
                            onClick={() => {
                              const trim = newStrategyInput.trim();
                              if (trim && !editingGlobal.strategies.includes(trim)) {
                                const nextGlobal = { ...editingGlobal, strategies: [...editingGlobal.strategies, trim] };
                                setEditingGlobal(nextGlobal);
                                saveGlobalSettingsDoc(nextGlobal);
                                setNewStrategyInput('');
                              }
                            }}
                            className="bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/25 px-3 py-1 rounded-lg text-[9px] font-bold"
                          >
                            ＋ 新增
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                </div>

              </div>

            </div>
          </div>
        )}

      </main>

      {/* ============================================================================
          DYNAMIC AUTHENTICATION MODAL (GOOGLE & EMAIL/VERIFICATION)
          ============================================================================ */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#11141c] w-full max-w-md rounded-2xl border border-[#1b212f] p-6 space-y-5 shadow-2xl relative">
            
            <button 
              onClick={() => {
                setShowAuthModal(false);
                setAuthEmail('');
                setAuthPassword('');
              }}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 font-bold text-base transition-colors"
            >
              ✕
            </button>

            <div className="text-center space-y-1">
              <h3 className="text-base font-black bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent uppercase tracking-wider">
                {authMode === 'login' ? '會員登入' : '註冊會員'}
              </h3>
              <p className="text-[10px] text-[#64748b]">啟用雲端自動同步，防止本機快取遺失</p>
            </div>

            <button
              onClick={handleGoogleLogin}
              disabled={authLoading}
              className="w-full bg-[#161a25] hover:bg-[#1f2535] border border-[#232b3c] text-[#f8fafc] font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2.5 transition-all disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.61c-.29 1.5-.14 3.09-1.01 4.14v3.44h1.63c5.63-5.18 5.51-11.43 5.51-11.43z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.97-1.08 7.96-2.91l-3.44-3.44c-1.12.75-2.56 1.2-4.52 1.2-3.48 0-6.44-2.35-7.51-5.51H.74v3.47C2.72 21.2 7.01 24 12 24z" />
                <path fill="#FBBC05" d="M4.49 13.34C4.21 12.5 4.07 11.6 4.07 10.7c0-.9.14-1.8.42-2.64V4.59H.74C-.24 6.55-.24 8.75-.24 10.7c0 1.95 0 4.15.98 6.11l3.75-3.47z" />
                <path fill="#EA4335" d="M12 4.15c1.77-.03 3.47.63 4.73 1.83l3.52-3.52C18.02 1.05 15.11 0 12 0 7.01 0 2.72 2.8 0 6.11l3.75 3.47c1.07-3.16 4.03-5.51 7.51-5.51z" />
              </svg>
              使用 Google 帳戶快速安全登入
            </button>
            <p className="text-[9px] text-[#64748b] text-center leading-normal">
              ⚠️ 備註：在特定嵌入式沙盒環境中，瀏覽器會安全阻擋 Google 彈出視窗。若點擊無反應，請直接使用下方電子郵件「立即註冊」，功能完全相同。
            </p>

            {/* 🏆 ONE-CLICK DEMO LOGIN (資深工科交易員特設：沙盒無縫預覽) */}
            <div className="bg-[#1b2030]/30 border border-[#2d364f]/50 rounded-xl p-3.5 text-xs text-left space-y-2">
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <span>⚡</span> 擁有者一鍵無縫體驗入口 (Sandbox 演示通道)
              </span>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                如果您在當前沙盒中遇見 Google 彈窗阻擋，請直接點擊下方按鈕，系統將自動填寫最高權限信箱 <span className="text-[#f8fafc] font-bold font-mono">zeeu0710@gmail.com</span>：
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthEmail('zeeu0710@gmail.com');
                    setAuthPassword('ZeeeU2026!');
                    setAuthMode('login');
                    showToast("已自動載入擁有者測試信箱與預配密碼！請點選「安全登入終端」即可進入", "info");
                  }}
                  className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition-all"
                >
                  填入擁有者信箱 👑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthEmail('coach@quanttrader.pro');
                    setAuthPassword('coach2026');
                    setAuthMode('login');
                    showToast("已自動載入副管理員(Admin)測試信箱！請點選「安全登入終端」", "info");
                  }}
                  className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition-all"
                >
                  填入副管理(Admin) 🛠️
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-[1px] bg-[#1b212f] flex-1" />
              <span className="text-[9px] text-[#64748b] uppercase font-bold tracking-wider">或使用實名信箱</span>
              <div className="h-[1px] bg-[#1b212f] flex-1" />
            </div>

            <form onSubmit={authMode === 'login' ? handleEmailLogin : handleEmailRegister} className="space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold tracking-wider text-[#94a3b8]">帳戶電子信箱 (Email)</label>
                <input 
                  type="email" 
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold tracking-wider text-[#94a3b8]">安全防護密碼 (Password)</label>
                <input 
                  type="password" 
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-[#0a0c10] border border-[#1b212f] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#f8fafc] focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="••••••••"
                  required
                />
                {authMode === 'register' && (
                  <p className="text-[9px] text-[#64748b]">💡 密碼強度長度至少需高於 6 位數</p>
                )}
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-[#0d0f12] font-black py-3 rounded-xl text-xs tracking-wider transition-all disabled:opacity-50"
              >
                {authLoading ? '正在連結實時量化資料庫...' : authMode === 'login' ? '🔓 安全登入終端' : '🚀 註冊並發送安全認證信'}
              </button>
            </form>

            <div className="text-center text-xs">
              {authMode === 'login' ? (
                <p className="text-[#94a3b8]">
                  還沒有帳號嗎？{' '}
                  <span 
                    onClick={() => setAuthMode('register')}
                    className="text-emerald-400 font-bold cursor-pointer hover:underline"
                  >
                    立即免費註冊
                  </span>
                </p>
              ) : (
                <p className="text-[#94a3b8]">
                  已有帳號？{' '}
                  <span 
                    onClick={() => setAuthMode('login')}
                    className="text-emerald-400 font-bold cursor-pointer hover:underline"
                  >
                    返回登入
                  </span>
                </p>
              )}
            </div>

          </div>
        </div>
      )}

      {/* CUSTOM DIALOG: GUEST TO ACCOUNT DATA MIGRATION CONFIRMATION */}
      {confirmMigrationData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#11141d] w-full max-w-sm rounded-2xl border border-[#1b212f] p-6 space-y-4 shadow-2xl text-center">
            <span className="text-3xl">🔄</span>
            <h3 className="text-sm font-bold text-[#f8fafc]">同步本機暫存覆盤紀錄</h3>
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              檢測到您本機內存有未備份的實戰覆盤日記。是否要將這些紀錄全部遷移，併入您剛剛登入的雲端帳戶中？
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmMigrationData(null)}
                className="flex-1 bg-[#0a0c10] hover:bg-[#11141c] border border-[#1b212f] text-[#94a3b8] py-2.5 rounded-xl text-xs font-bold transition-colors"
              >
                保留雲端原配置
              </button>
              <button
                onClick={executeDataMigration}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-[#0d0f12] py-2.5 rounded-xl text-xs font-black transition-colors"
              >
                確定遷移
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DIALOG: SECURE CONFIRM RECORD DELETION MODAL */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="bg-[#11141d] w-full max-w-xs rounded-2xl border border-rose-500/20 p-5 space-y-4 shadow-2xl text-center">
            <span className="text-2xl">🗑️</span>
            <h3 className="text-xs font-bold text-[#f8fafc]">確定抹除此筆實戰紀錄嗎？</h3>
            <p className="text-[10px] text-[#94a3b8]">
              此覆盤紀錄將自本端與雲端資料庫永久刪除，不可撤銷。
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 bg-[#0a0c10] hover:bg-[#11141c] border border-[#1b212f] text-[#94a3b8] py-2 rounded-xl text-xs font-bold transition-colors"
              >
                取消
              </button>
              <button
                onClick={executeDeleteRecord}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2 rounded-xl text-xs font-bold transition-colors"
              >
                確認抹除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-[#050608] border-t border-[#121622] py-6 px-6 text-center text-[10px] text-[#64748b]">
        <p>© 2026 QuantTrader Pro. 經 BingX 實時永續算術引擎與資深網頁工程架構編譯。</p>
      </footer>

    </div>
  );
}