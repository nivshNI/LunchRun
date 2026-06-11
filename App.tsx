
import React, { useState, useEffect, useRef } from 'react';
import { FoodRun, Order, WaitingOrder } from './types';
import { Button } from './components/Button';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  collection, 
  doc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  getDoc,
  runTransaction,
  writeBatch,
  serverTimestamp,
  limit,
  handleFirestoreError,
  OperationType 
} from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

const extractDomain = (email: string) => {
  const parts = email.split('@');
  return parts.length > 1 ? parts[1].toLowerCase() : 'public';
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [runs, setRuns] = useState<FoodRun[]>([]);
  const [waitlist, setWaitlist] = useState<WaitingOrder[]>([]);
  const [syncStatus, setSyncStatus] = useState<'ONLINE' | 'SYNCING' | 'LOCAL'>('ONLINE');
  const [view, setView] = useState<'runs' | 'waitlist' | 'admin'>('runs');
  const [modals, setModals] = useState<{ [key: string]: any }>({ create: false, join: null, wait: false, arrive: null });
  const [inputs, setInputs] = useState({ dest: '', time: 15, max: 6, item: '', floor: '', loc: '' });

  const [lastError, setLastError] = useState<string | null>(null);

  const isAdmin = user?.email === 'niv.shtaif@naturalint.com';
  const domainId = user ? extractDomain(user.email!) : 'public';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthLoading(false);
      
      if (u) {
        // Upsert user profile
        const dId = extractDomain(u.email!);
        console.log("Logged in user:", u.email, "Domain ID:", dId);
        try {
          await setDoc(doc(db, 'domains', dId, 'users', u.uid), {
            name: u.displayName || u.email!.split('@')[0],
            email: u.email,
            lastLogin: serverTimestamp()
          }, { merge: true });
        } catch (e: any) {
          console.error("Profile sync failed", e);
          setLastError(`Profile sync failed: ${e.message}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time synchronization
  useEffect(() => {
    if (!user) return;

    setSyncStatus('SYNCING');
    
    // Listen for Runs
    const runsQuery = query(
      collection(db, 'domains', domainId, 'runs'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    
    const unsubRuns = onSnapshot(runsQuery, (snapshot) => {
      const runsData: FoodRun[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'active' || data.status === 'departed') {
          runsData.push({ id: doc.id, ...data } as FoodRun);
        }
      });
      setRuns(runsData);
      setSyncStatus('ONLINE');
      setLastError(null);
    }, (error: any) => {
      console.error("Runs listener failed", error);
      setSyncStatus('LOCAL');
      setLastError(`Sync failed: ${error.code || 'UNKNOWN'} - ${error.message}`);
    });

    // Listen for Waitlist
    const waitQuery = query(
      collection(db, 'domains', domainId, 'waitlist'),
      orderBy('timestamp', 'desc'),
      limit(30)
    );
    
    const unsubWait = onSnapshot(waitQuery, (snapshot) => {
      const waitData: WaitingOrder[] = [];
      snapshot.forEach((doc) => {
        waitData.push({ id: doc.id, ...doc.data() } as WaitingOrder);
      });
      setWaitlist(waitData);
    }, (error) => {
      console.error("Waitlist listener failed", error);
    });

    return () => {
      unsubRuns();
      unsubWait();
    };
  }, [user, domainId]);

  const handleStartRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (inputs.max < 1) { setLastError('Max orders must be at least 1'); return; }
    if (inputs.time < 1) { setLastError('Departure time must be at least 1 minute'); return; }

    try {
      const newRun = {
        runnerName: user.displayName || user.email!.split('@')[0],
        runnerEmail: user.email,
        runnerId: user.uid,
        destination: inputs.dest.toUpperCase(),
        departureTime: Date.now() + (inputs.time * 60000),
        minutesUntilDeparture: inputs.time,
        maxOrders: Number(inputs.max),
        status: 'active',
        orderCount: 0,
        createdAt: serverTimestamp()
      };
      
      await addDoc(collection(db, 'domains', domainId, 'runs'), newRun);
      setModals({ ...modals, create: false });
      setInputs({ ...inputs, dest: '', time: 15, max: 6 });
      setLastError(null);
    } catch (error: any) {
      console.error("Run creation failed", error);
      setLastError(`Failed to start run: ${error.message || 'Unknown error'}`);
      handleFirestoreError(error, OperationType.WRITE, `domains/${domainId}/runs`);
    }
  };

  const handleJoinRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !modals.join) return;
    
    const runId = modals.join;
    try {
      await runTransaction(db, async (transaction) => {
        const runRef = doc(db, 'domains', domainId, 'runs', runId);
        const runDoc = await transaction.get(runRef);
        
        if (!runDoc.exists()) throw new Error("Run does not exist!");
        const runData = runDoc.data();
        
        if (runData.orderCount >= runData.maxOrders) {
          throw new Error("Run is full!");
        }
        
        const orderId = Math.random().toString(36).substr(2, 9);
        const orderRef = doc(db, 'domains', domainId, 'runs', runId, 'orders', orderId);
        
        transaction.update(runRef, {
          orderCount: runData.orderCount + 1
        });
        
        transaction.set(orderRef, {
          userName: user.displayName || user.email!.split('@')[0],
          userEmail: user.email,
          userId: user.uid,
          itemDescription: inputs.item,
          floor: inputs.floor,
          timestamp: Date.now()
        });
      });
      
      setModals({ ...modals, join: null });
      setInputs({ ...inputs, item: '', floor: '' });
      setLastError(null);
    } catch (error: any) {
      console.error("Join run failed", error);
      setLastError(`Failed to join run: ${error.message || 'Unknown error'}`);
      handleFirestoreError(error, OperationType.WRITE, `domains/${domainId}/runs/${runId}/orders`);
    }
  };

  const promoteFromWaitlist = async (runId: string, waitId: string) => {
    const waiter = waitlist.find(w => w.id === waitId);
    if (!waiter || !user) return;
    
    try {
      await runTransaction(db, async (transaction) => {
        const runRef = doc(db, 'domains', domainId, 'runs', runId);
        const runDoc = await transaction.get(runRef);
        if (!runDoc.exists()) throw new Error("Run does not exist!");
        const runData = runDoc.data();
        
        if (runData.orderCount >= runData.maxOrders) throw new Error("Run is full!");
        
        const waitRef = doc(db, 'domains', domainId, 'waitlist', waitId);
        const orderId = waitId; // Reuse ID
        const orderRef = doc(db, 'domains', domainId, 'runs', runId, 'orders', orderId);
        
        transaction.update(runRef, { orderCount: runData.orderCount + 1 });
        transaction.set(orderRef, {
          userName: waiter.userName,
          userEmail: waiter.userEmail,
          userId: waiter.userId,
          itemDescription: waiter.itemDescription,
          floor: waiter.floor,
          timestamp: Date.now()
        });
        transaction.delete(waitRef);
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `domains/${domainId}/runs/${runId}`);
    }
  };

  const handleSignalInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const newItem = {
        userName: user.displayName || user.email!.split('@')[0],
        userEmail: user.email,
        userId: user.uid,
        destination: inputs.dest.toUpperCase(),
        itemDescription: inputs.item,
        floor: inputs.floor,
        timestamp: Date.now()
      };
      
      await addDoc(collection(db, 'domains', domainId, 'waitlist'), newItem);
      setModals({ ...modals, wait: false });
      setInputs({ ...inputs, dest: '', item: '', floor: '' });
      setView('waitlist');
      setLastError(null);
    } catch (error: any) {
      console.error("Waitlist signal failed", error);
      setLastError(`Failed to add to waitlist: ${error.message || 'Unknown error'}`);
      handleFirestoreError(error, OperationType.WRITE, `domains/${domainId}/waitlist`);
    }
  };

  const handleDepart = async (runId: string) => {
    try {
      await updateDoc(doc(db, 'domains', domainId, 'runs', runId), { status: 'departed' });
    } catch (error: any) {
      setLastError(`Failed to depart: ${error.message || 'Unknown error'}`);
    }
  };

  const handleCancel = async (runId: string) => {
    try {
      await updateDoc(doc(db, 'domains', domainId, 'runs', runId), { status: 'cancelled' });
    } catch (error: any) {
      setLastError(`Failed to cancel: ${error.message || 'Unknown error'}`);
    }
  };

  const handleArrive = async (e: React.FormEvent) => {
    e.preventDefault();
    const runId = modals.arrive;
    if (!runId) return;

    try {
      await updateDoc(doc(db, 'domains', domainId, 'runs', runId), {
        status: 'arrived',
        arrivalLocation: inputs.loc,
        arrivalTime: Date.now()
      });
      setModals({ ...modals, arrive: null });
      setInputs({ ...inputs, loc: '' });
    } catch (error: any) {
      setLastError(`Failed to mark arrival: ${error.message || 'Unknown error'}`);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8faff]">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#f8faff]">
        <div className="w-full max-w-sm p-8 bg-white/80 backdrop-blur-xl border border-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-3xl flex items-center justify-center text-white text-2xl mx-auto mb-8 shadow-xl shadow-indigo-200">
            <i className="fas fa-burger"></i>
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">LunchRun</h1>
          <p className="text-slate-500 mb-8 text-sm">Join your office's food logistics network.</p>
          <Button onClick={() => loginWithGoogle()} className="w-full h-14 bg-slate-900 text-white rounded-2xl font-bold text-sm tracking-wide shadow-lg hover:bg-black flex items-center justify-center gap-3">
             <i className="fab fa-google"></i> Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] bg-black text-white text-[10px] px-4 py-1 rounded-full font-mono">
        v2.2 | {user.email} | {domainId} | {syncStatus} | DB: {auth ? 'AUTH_OK' : 'AUTH_NO'}
      </div>
      <div className="fixed top-6 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl z-50">
        <nav className="glass h-16 px-6 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.04)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-sm shadow-lg shadow-indigo-100">
              <i className="fas fa-bolt"></i>
            </div>
            <span className="font-black text-lg tracking-tighter text-slate-900">LR</span>
          </div>

          {lastError && (
            <div className="absolute top-20 left-0 right-0 p-4 bg-red-50 border border-red-100 rounded-2xl text-[10px] font-bold text-red-500 uppercase tracking-wider animate-in fade-in slide-in-from-top-2 z-40 text-center shadow-xl shadow-red-50/50">
              <i className="fas fa-exclamation-triangle mr-2"></i>
              {lastError}
              <button onClick={() => setLastError(null)} className="ml-4 opacity-50 hover:opacity-100">✕</button>
            </div>
          )}

          <div className="flex items-center gap-3 p-1 bg-slate-100/50 rounded-2xl">
            <button onClick={() => setView('runs')} className={`px-5 h-9 rounded-xl text-xs font-bold transition-all ${view === 'runs' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
              Runs
            </button>
            <button onClick={() => setView('waitlist')} className={`px-5 h-9 rounded-xl text-xs font-bold transition-all ${view === 'waitlist' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
              Waitlist {waitlist.length > 0 && <span className="ml-1 opacity-50">{waitlist.length}</span>}
            </button>
            {isAdmin && (
              <button onClick={() => setView('admin')} className={`px-5 h-9 rounded-xl text-xs font-bold transition-all ${view === 'admin' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
                Admin
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-bold text-slate-900 leading-none truncate max-w-[100px]">{user.displayName}</span>
              <div className="flex items-center gap-1 mt-1">
                <span className={`text-[9px] font-black uppercase tracking-widest ${syncStatus === 'ONLINE' ? 'text-emerald-500' : 'text-amber-500'}`}>{syncStatus}</span>
                <span className="text-[7px] text-slate-300 font-bold" title={auth.currentUser?.email || ''}>[{domainId}]</span>
              </div>
            </div>
            <button onClick={() => logout()} className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 font-black text-xs hover:bg-indigo-100 transition-colors">
              {user.displayName?.charAt(0) || 'U'}
            </button>
          </div>
        </nav>
      </div>

      <main className="max-w-4xl mx-auto px-6 pt-32 pb-24">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">
              {view === 'runs' ? "Active Runs" : "Waitlist"}
            </h1>
            <p className="text-slate-500 text-sm font-medium">
              {view === 'runs' ? "Real-time office food deployments." : "People waiting for their favorite spots."}
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setModals({ ...modals, wait: true })} variant="secondary" className="h-12 px-6 rounded-2xl text-xs font-bold bg-white border border-slate-200">
              <i className="fas fa-clock mr-2 opacity-50"></i> I'm Hungry
            </Button>
            <Button onClick={() => setModals({ ...modals, create: true })} className="h-12 px-8 bg-indigo-600 text-white rounded-2xl text-xs font-bold shadow-xl shadow-indigo-100">
              <i className="fas fa-plus mr-2"></i> Start Run
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {view === 'runs' ? (
            runs.length === 0 ? (
              <EmptyState icon="fa-utensils" title="The office is quiet" subtitle="No one is out for food yet. Why not be the first?" />
            ) : (
              runs.map(run => (
                <RunCard
                  key={run.id}
                  run={run}
                  domainId={domainId}
                  userEmail={user.email!}
                  onJoin={() => setModals({ ...modals, join: run.id })}
                  onArrive={() => setModals({ ...modals, arrive: run.id })}
                  onDepart={() => handleDepart(run.id)}
                  onCancel={() => handleCancel(run.id)}
                  waitlist={waitlist}
                  onPromote={(waitId) => promoteFromWaitlist(run.id, waitId)}
                />
              ))
            )
          ) : view === 'waitlist' ? (
            waitlist.length === 0 ? (
              <EmptyState icon="fa-smile" title="Waitlist is clear" subtitle="Everyone is either full or has an active run." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {waitlist.map(item => (
                  <WaitCard key={item.id} item={item} />
                ))}
              </div>
            )
          ) : (
            <AdminDashboard domainId={domainId} runs={runs} waitlist={waitlist} />
          )}
        </div>
      </main>

      {modals.create && (
        <Modal title="Deploy New Run" onClose={() => setModals({ ...modals, create: false })}>
          <form onSubmit={handleStartRun} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Where are you going?</label>
              <input required autoFocus className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-lg font-bold outline-none focus:ring-2 focus:ring-indigo-500/10 placeholder:text-slate-300 uppercase" placeholder="VITRINA" value={inputs.dest} onChange={e => setInputs({ ...inputs, dest: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Departure (Min)</label>
                <input type="number" className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-lg font-bold outline-none" value={inputs.time} onChange={e => setInputs({ ...inputs, time: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Max Orders</label>
                <input type="number" className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-lg font-bold outline-none" value={inputs.max} onChange={e => setInputs({ ...inputs, max: Number(e.target.value) })} />
              </div>
            </div>
            <Button type="submit" className="w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-indigo-100">Broadcast Now</Button>
          </form>
        </Modal>
      )}

      {modals.wait && (
        <Modal title="Signal Interest" onClose={() => setModals({ ...modals, wait: false })}>
          <form onSubmit={handleSignalInterest} className="space-y-4">
            <input required className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-sm font-bold outline-none" placeholder="Restaurant name" value={inputs.dest} onChange={e => setInputs({ ...inputs, dest: e.target.value })} />
            <input required className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-sm font-bold outline-none" placeholder="Specific item?" value={inputs.item} onChange={e => setInputs({ ...inputs, item: e.target.value })} />
            <input required className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-sm font-bold outline-none" placeholder="Drop-off (Floor/Desk)" value={inputs.floor} onChange={e => setInputs({ ...inputs, floor: e.target.value })} />
            <Button type="submit" className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase mt-2">Add to Queue</Button>
          </form>
        </Modal>
      )}

      {modals.join && (
        <Modal title="Join Food Run" onClose={() => setModals({ ...modals, join: null })}>
          <form onSubmit={handleJoinRun} className="space-y-4">
            <input required autoFocus className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-sm font-bold outline-none" placeholder="Your order details" value={inputs.item} onChange={e => setInputs({ ...inputs, item: e.target.value })} />
            <input required className="w-full h-14 px-5 bg-slate-50 border-none rounded-2xl text-sm font-bold outline-none" placeholder="Floor / Drop-off" value={inputs.floor} onChange={e => setInputs({ ...inputs, floor: e.target.value })} />
            <Button type="submit" className="w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase">Confirm Join</Button>
          </form>
        </Modal>
      )}

      {modals.arrive && (
        <Modal title="Confirm Arrival" onClose={() => setModals({ ...modals, arrive: null })}>
          <form onSubmit={handleArrive} className="space-y-6 text-center">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 text-3xl">
               <i className="fas fa-check"></i>
            </div>
            <p className="text-slate-500 font-medium text-sm mb-6">Type the drop-off location below to notify everyone.</p>
            <input required autoFocus className="w-full h-16 px-5 bg-slate-50 border-none rounded-2xl text-center text-2xl font-black outline-none focus:ring-2 focus:ring-emerald-500/10 uppercase" placeholder="KITCHEN FL 4" value={inputs.loc} onChange={e => setInputs({ ...inputs, loc: e.target.value })} />
            <Button type="submit" className="w-full h-14 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase mt-4">Mission Accomplished</Button>
          </form>
        </Modal>
      )}
    </div>
  );
};

const RunCard: React.FC<{ run: FoodRun, domainId: string, userEmail: string, onJoin: () => void, onArrive: () => void, onDepart: () => void, onCancel: () => void, waitlist: WaitingOrder[], onPromote: (id: string) => void }> = ({ run, domainId, userEmail, onJoin, onArrive, onDepart, onCancel, waitlist, onPromote }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.round((run.departureTime - Date.now()) / 1000)));

  useEffect(() => {
    const q = query(collection(db, 'domains', domainId, 'runs', run.id, 'orders'), orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const ordersData: Order[] = [];
      snapshot.forEach(doc => ordersData.push({ id: doc.id, ...doc.data() } as Order));
      setOrders(ordersData);
    });
  }, [run.id, domainId]);

  useEffect(() => {
    if (run.status !== 'active') return;
    const interval = setInterval(() => {
      const s = Math.max(0, Math.round((run.departureTime - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [run.departureTime, run.status]);

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const isOwner = userEmail.toLowerCase() === run.runnerEmail.toLowerCase();
  const hasJoined = orders.some(o => o.userEmail.toLowerCase() === userEmail.toLowerCase());
  const spotsLeft = run.maxOrders - (run.orderCount || 0);
  const relevantWaiters = waitlist.filter(w => w.destination.toUpperCase() === run.destination.toUpperCase());

  return (
    <div className="bg-white/90 backdrop-blur-md border border-white rounded-[2.5rem] p-8 card-glow transition-all duration-500 hover:-translate-y-1 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
      <div className="flex flex-col md:flex-row justify-between items-start gap-10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${run.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600 animate-pulse'}`}>
              {run.status === 'active' ? 'ENROLLING' : 'ON THE WAY'}
            </span>
            {run.status === 'active' && (
              <span className="text-[10px] font-black px-3 py-1 rounded-full bg-amber-50 text-amber-500 tabular-nums">
                {formatCountdown(secondsLeft)}
              </span>
            )}
            <span className="text-slate-300">•</span>
            <div className="flex items-center gap-2">
               <div className="w-5 h-5 bg-slate-100 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-500">{run.runnerName.charAt(0)}</div>
               <span className="text-xs font-bold text-slate-400 uppercase tracking-tight truncate">{run.runnerName}</span>
            </div>
          </div>
          
          <h3 className="text-3xl font-black text-slate-900 tracking-tighter mb-8 leading-none">{run.destination}</h3>

          {orders.length > 0 && (
            <div className="space-y-3 mb-8">
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-list-ul"></i> Manifest
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {orders.map(o => (
                  <div key={o.id} className="flex items-center gap-3 bg-slate-50/50 p-3 rounded-2xl border border-white">
                    <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-indigo-600 font-bold text-[10px] shadow-sm">{o.userName?.charAt(0)}</div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-800 truncate">{o.itemDescription}</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase">FL {o.floor}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isOwner && relevantWaiters.length > 0 && spotsLeft > 0 && (
            <div className="bg-gradient-to-tr from-indigo-50/50 to-violet-50/50 rounded-[1.75rem] p-5 border border-indigo-100/50">
              <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <i className="fas fa-magic"></i> Matches Found
              </div>
              <div className="flex flex-wrap gap-2">
                {relevantWaiters.map(w => (
                  <button key={w.id} onClick={() => onPromote(w.id)} className="px-4 py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-600 hover:text-white transition-all shadow-sm border border-indigo-100/30">
                    + Add {w.userName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-full md:w-48 flex flex-col items-center justify-between gap-6">
          <div className="text-center p-6 bg-slate-50/50 rounded-[2rem] w-full border border-white">
            <div className="text-5xl font-black text-slate-900 tracking-tighter mb-1">{spotsLeft}</div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Slots</div>
          </div>
          
          <div className="w-full space-y-3">
            {isOwner ? (
              run.status === 'active' ? (
                <>
                  <Button onClick={onDepart} className="w-full h-14 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100">Go Now</Button>
                  <Button onClick={onCancel} className="w-full h-10 bg-red-50 text-red-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-100 transition-colors">Cancel</Button>
                </>
              ) : (
                <Button onClick={onArrive} className="w-full h-14 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-100">Arrived</Button>
              )
            ) : (
              !hasJoined && run.status === 'active' && spotsLeft > 0 ? (
                <Button onClick={onJoin} className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black">Join Mission</Button>
              ) : (
                <div className="w-full py-4 text-center text-[10px] font-black text-slate-300 bg-slate-100/50 rounded-2xl border border-white uppercase tracking-[0.3em]">Locked</div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const WaitCard: React.FC<{ item: WaitingOrder }> = ({ item }) => (
  <div className="bg-white/80 backdrop-blur-md border border-white rounded-[2rem] p-6 flex justify-between items-center group card-glow transition-all duration-300 hover:-translate-y-1 shadow-sm">
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-2">
        <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{item.destination}</h4>
        <span className="text-[9px] font-black text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100 uppercase tracking-wider">Queue</span>
      </div>
      <p className="text-xs text-slate-600 font-medium truncate">
        <span className="font-black text-slate-900">{item.userName}</span>: {item.itemDescription}
      </p>
    </div>
    <div className="text-right flex-shrink-0 ml-6">
      <div className="text-[10px] font-black text-slate-400 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 uppercase mb-1">FL {item.floor}</div>
      <div className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  </div>
);

const EmptyState: React.FC<{ icon: string, title: string, subtitle: string }> = ({ icon, title, subtitle }) => (
  <div className="py-24 flex flex-col items-center text-center animate-float">
    <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200 text-3xl mb-8 border border-white shadow-inner">
      <i className={`fas ${icon}`}></i>
    </div>
    <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight uppercase">{title}</h3>
    <p className="text-sm text-slate-400 font-medium max-w-[280px] leading-relaxed">{subtitle}</p>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-white border border-white rounded-[2.5rem] w-full max-w-md shadow-[0_30px_70px_rgba(0,0,0,0.1)] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
      <div className="px-8 py-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
        <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em]">{title}</h3>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-slate-600 transition-colors">
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>
      <div className="p-8">
        {children}
      </div>
    </div>
  </div>
);

const AdminDashboard: React.FC<{ domainId: string, runs: FoodRun[], waitlist: WaitingOrder[] }> = ({ domainId, runs, waitlist }) => {
  const [history, setHistory] = useState<FoodRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  
  useEffect(() => {
    const q = query(collection(db, 'domains', domainId, 'runs'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snapshot) => {
      const data: FoodRun[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as FoodRun));
      setHistory(data);
      setLoading(false);
    });

    const userQ = query(collection(db, 'domains', domainId, 'users'), limit(50));
    const unsubUsers = onSnapshot(userQ, (snapshot) => {
      const uData: any[] = [];
      snapshot.forEach(doc => uData.push({ id: doc.id, ...doc.data() }));
      setUsers(uData);
    });

    return () => { unsub(); unsubUsers(); };
  }, [domainId]);

  const totalHistory = history.length;
  const currentActive = history.filter(r => r.status === 'active' || r.status === 'departed').length;
  const totalCompleted = history.filter(r => r.status === 'arrived').length;
  const totalOrders = history.reduce((acc, r) => acc + (r.orderCount || 0), 0);
  const uniqueRunners = new Set(history.map(h => h.runnerId)).size;
  
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Analytics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-white rounded-3xl p-6 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Active Runs</div>
          <div className="text-4xl font-black text-indigo-600">{currentActive}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2">Currently in progress</div>
        </div>
        <div className="bg-white border border-white rounded-3xl p-6 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Total Orders</div>
          <div className="text-4xl font-black text-emerald-600">{totalOrders}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2">Items delivered so far</div>
        </div>
        <div className="bg-white border border-white rounded-3xl p-6 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Active Runners</div>
          <div className="text-4xl font-black text-amber-500">{uniqueRunners}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2">Unique users acting as runners</div>
        </div>
        <div className="bg-white border border-white rounded-3xl p-6 shadow-sm">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">User Base</div>
          <div className="text-4xl font-black text-slate-900">{users.length}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-2">Registered members in domain</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* System History */}
        <div className="bg-white border border-white rounded-[2.5rem] p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight flex items-center gap-3">
            <i className="fas fa-history text-indigo-200"></i>
            Activity Log
          </h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {history.map(run => (
              <div key={run.id} className="flex items-center justify-between py-4 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-4 -mx-4 rounded-2xl transition-colors">
                <div className="flex items-baseline gap-4">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'arrived' ? 'bg-slate-300' : run.status === 'departed' ? 'bg-amber-400' : 'bg-emerald-500'}`}></div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">{run.runnerName} ➔ {run.destination}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      {run.status} • {run.orderCount} orders • {new Date(run.arrivalLocation ? run.arrivalTime! : run.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-black text-slate-300 uppercase">
                    {run.createdAt?.seconds ? new Date(run.createdAt.seconds * 1000).toLocaleDateString() : 'Now'}
                  </div>
                </div>
              </div>
            ))}
            {!loading && history.length === 0 && <div className="text-sm text-slate-400 text-center py-8">No historical data available.</div>}
            {loading && <div className="text-center py-8 animate-pulse text-slate-200 tracking-widest uppercase text-xs">Accessing vault...</div>}
          </div>
        </div>

        {/* Registered Users */}
        <div className="bg-white border border-white rounded-[2.5rem] p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-6 uppercase tracking-tight flex items-center gap-3">
            <i className="fas fa-users text-indigo-200"></i>
            User Directory
          </h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0">
                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 font-black text-xs border border-white shadow-inner">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{u.name}</div>
                  <div className="text-[10px] font-medium text-slate-400">{u.email}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[9px] font-black text-slate-200 uppercase tracking-tighter">Last Active</div>
                  <div className="text-[10px] font-bold text-slate-300">
                    {u.lastLogin?.seconds ? new Date(u.lastLogin.seconds * 1000).toLocaleDateString() : 'New'}
                  </div>
                </div>
              </div>
            ))}
            {users.length === 0 && <div className="text-sm text-slate-400 text-center py-8">No users registered yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
