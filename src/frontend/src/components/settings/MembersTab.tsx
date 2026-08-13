import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Mail, Shield, User, X } from 'lucide-react';

interface Member {
  id: string;
  email: string;
  name: string;
  role: 'Owner' | 'Admin' | 'Member';
  avatarUrl?: string;
}

export function MembersTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'Admin' | 'Member'>('Member');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      
      setFailed(null);
      const res = await fetch('/api/v1/tenant/members');
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else {
        setMembers([]);
        setFailed('ядро не віддало список');
      }
    } catch (err) {
      setMembers([]);
      setFailed('ядро не відповідає');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    try {
      setInviting(true);
      const res = await fetch('/api/v1/tenant/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      if (res.ok) {
        // Mock appending the new invited user for now since the API might not truly store it
        setMembers(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            name: inviteEmail.split('@')[0],
            email: inviteEmail,
            role: inviteRole,
          }
        ]);
        setShowInviteModal(false);
        setInviteEmail('');
        setInviteRole('Member');
      } else {
        alert('Failed to invite member');
      }
    } catch (err) {
      alert('Failed to invite member');
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-primary">Team Members</h2>
          <p className="text-sm text-muted">Manage your workspace members and their roles.</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl transition-all shadow-sm backdrop-blur-md text-sm font-medium text-primary"
        >
          <Plus size={16} />
          Invite Member
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {members.length === 0 && (
          <div className="p-4 bg-black/20 border border-white/5 rounded-2xl backdrop-blur-md text-sm text-muted">
            {failed ?? 'у цьому просторі поки лише ти'}
          </div>
        )}
        {members.map(member => (
          <div key={member.id} className="flex items-center justify-between p-4 bg-black/20 border border-white/5 rounded-2xl backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center overflow-hidden">
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                ) : (
                  <User size={18} className="text-primary/70" />
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-primary">{member.name}</span>
                <span className="text-xs text-muted">{member.email}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                member.role === 'Owner' 
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : member.role === 'Admin'
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                  : 'bg-white/5 border-white/10 text-muted'
              }`}>
                {member.role}
              </span>
            </div>
          </div>
        ))}
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1C1C1C] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
            <button
              onClick={() => setShowInviteModal(false)}
              className="absolute top-4 right-4 text-muted hover:text-primary transition-colors"
            >
              <X size={20} />
            </button>
            
            <div className="p-6">
              <h3 className="text-xl font-semibold text-primary mb-1">Invite to Workspace</h3>
              <p className="text-sm text-muted mb-6">Send an email invitation to join your team.</p>
              
              <form onSubmit={handleInvite} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted uppercase tracking-wider">Email Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-sm text-primary placeholder:text-muted/50 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                    />
                  </div>
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted uppercase tracking-wider">Role</label>
                  <div className="relative">
                    <Shield size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as 'Admin' | 'Member')}
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-sm text-primary focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all appearance-none cursor-pointer"
                    >
                      <option value="Member">Member</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                </div>
                
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail}
                  className="mt-2 w-full py-2.5 bg-white text-black hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-white font-medium text-sm rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {inviting ? <Loader2 size={16} className="animate-spin" /> : 'Send Invitation'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
