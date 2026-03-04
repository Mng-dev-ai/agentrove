import { useState, useEffect } from 'react';
import { Smartphone, Mail, UserCircle, Lock, KeyRound, Building2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Switch } from '@/components/ui/primitives/Switch';
import { Label } from '@/components/ui/primitives/Label';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { Textarea } from '@/components/ui/primitives/Textarea';
import toast from 'react-hot-toast';
import { apiClient } from '@/lib/api';
import { useEnterpriseMode } from '@/hooks/queries/useEnterpriseMode';
import type { UserProfile, UserProfileUpdate } from '@/types/user.types';

interface AuthSettings {
  pin_enabled: boolean;
  passwordless_enabled: boolean;
  has_password: boolean;
}

export function ProfilesSection() {
  const { data: enterpriseModeData } = useEnterpriseMode();
  const enterpriseMode = enterpriseModeData?.enabled ?? false;
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  // Profile form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [authResponse, profileResponse] = await Promise.all([
          apiClient.get<AuthSettings>('/auth/settings'),
          apiClient.get<UserProfile>('/auth/profile'),
        ]);
        setAuthSettings(authResponse);
        setProfile(profileResponse);
        // Initialize form fields
        setFirstName(profileResponse.first_name || '');
        setLastName(profileResponse.last_name || '');
        setDisplayName(profileResponse.display_name || '');
        setCompanyName(profileResponse.company_name || '');
        setJobTitle(profileResponse.job_title || '');
        setPhone(profileResponse.phone || '');
        setBio(profileResponse.bio || '');
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handlePinSetup = async () => {
    if (pin.length < 4 || pin.length > 6) {
      toast.error('PIN must be 4-6 digits');
      return;
    }
    if (pin !== confirmPin) {
      toast.error('PINs do not match');
      return;
    }
    if (!/^\d+$/.test(pin)) {
      toast.error('PIN must contain only digits');
      return;
    }

    setSetupLoading(true);
    try {
      await apiClient.post('/auth/pin/setup', { pin });
      setAuthSettings((prev) => prev ? { ...prev, pin_enabled: true } : null);
      setShowPinSetup(false);
      setPin('');
      setConfirmPin('');
      toast.success('PIN set up successfully');
    } catch {
      toast.error('Failed to set up PIN');
    } finally {
      setSetupLoading(false);
    }
  };

  const handlePasswordlessToggle = async (enabled: boolean) => {
    try {
      await apiClient.patch('/auth/settings', { passwordless_enabled: enabled });
      setAuthSettings((prev) => prev ? { ...prev, passwordless_enabled: enabled } : null);
      toast.success(enabled ? 'Passwordless login enabled' : 'Passwordless login disabled');
    } catch {
      toast.error('Failed to update settings');
    }
  };

  const handlePinToggle = async (enabled: boolean) => {
    if (enabled && !authSettings?.pin_enabled) {
      setShowPinSetup(true);
      return;
    }
    try {
      if (!enabled) {
        await apiClient.delete('/auth/pin');
        setAuthSettings((prev) => prev ? { ...prev, pin_enabled: false } : null);
        toast.success('PIN login disabled');
      }
    } catch {
      toast.error('Failed to disable PIN');
    }
  };

  const handlePasswordChange = async () => {
    if (!currentPassword) {
      toast.error('Current password is required');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setPasswordLoading(true);
    try {
      await apiClient.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setShowPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    } catch {
      toast.error('Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileLoading(true);
    try {
      const updateData: UserProfileUpdate = {
        first_name: firstName || null,
        last_name: lastName || null,
        display_name: displayName || null,
        company_name: companyName || null,
        job_title: jobTitle || null,
        phone: phone || null,
        bio: bio || null,
      };
      const updated = await apiClient.patch<UserProfile>('/auth/profile', updateData);
      setProfile(updated);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setProfileLoading(false);
    }
  };

  const hasProfileChanges = () => {
    return (
      (firstName || '') !== (profile?.first_name || '') ||
      (lastName || '') !== (profile?.last_name || '') ||
      (displayName || '') !== (profile?.display_name || '') ||
      (companyName || '') !== (profile?.company_name || '') ||
      (jobTitle || '') !== (profile?.job_title || '') ||
      (phone || '') !== (profile?.phone || '') ||
      (bio || '') !== (profile?.bio || '')
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Profile Settings
        </h2>
        <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Manage your personal information and login preferences
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Personal Information */}
          <div className="rounded-xl border border-border p-4 dark:border-border-dark">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                <UserCircle className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
              </div>
              <div>
                <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                  Personal Information
                </h3>
                <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  Update your name and contact details
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  First Name
                </Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Last Name
                </Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Display Name
                </Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Email
                </Label>
                <Input
                  value={profile?.email || ''}
                  disabled
                  className="bg-surface-tertiary dark:bg-surface-dark-tertiary"
                />
              </div>
            </div>

            {hasProfileChanges() && (
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleProfileSave}
                  isLoading={profileLoading}
                >
                  Save Changes
                </Button>
              </div>
            )}
          </div>

          {/* Company Information - Only shown in Enterprise mode */}
          {enterpriseMode && (
            <div className="rounded-xl border border-border p-4 dark:border-border-dark">
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  <Building2 className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    Company Information
                  </h3>
                  <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    Your company and job details
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Company Name
                  </Label>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company name"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Job Title
                  </Label>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="Job title"
                  />
                </div>
              </div>

              {hasProfileChanges() && (
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleProfileSave}
                    isLoading={profileLoading}
                  >
                    Save Changes
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Contact & Bio */}
          <div className="rounded-xl border border-border p-4 dark:border-border-dark">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                <Phone className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
              </div>
              <div>
                <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                  Contact & Bio
                </h3>
                <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  Phone number and bio
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Phone Number
                </Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 234 567 8900"
                  type="tel"
                />
              </div>
              <div>
                <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                  Bio
                </Label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short bio about yourself..."
                  rows={3}
                  maxLength={500}
                />
                <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {bio.length}/500 characters
                </p>
              </div>
            </div>

            {hasProfileChanges() && (
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleProfileSave}
                  isLoading={profileLoading}
                >
                  Save Changes
                </Button>
              </div>
            )}
          </div>

          {/* Authentication Section */}
          <div className="pt-4 border-t border-border dark:border-border-dark">
            <h3 className="mb-4 text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
              Login Methods
            </h3>
          </div>

          {/* Password */}
          <div className="rounded-xl border border-border p-4 dark:border-border-dark">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  <Lock className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    Password
                  </h3>
                  <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    Change your account password
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPasswordChange(!showPasswordChange)}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            </div>

            {showPasswordChange && (
              <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface-secondary/50 p-4 dark:border-border-dark dark:bg-surface-dark-secondary/50">
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Current Password
                  </Label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    New Password
                  </Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Confirm New Password
                  </Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handlePasswordChange}
                    isLoading={passwordLoading}
                  >
                    Change Password
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowPasswordChange(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-4 dark:border-border-dark">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  <Smartphone className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    PIN Login
                  </h3>
                  <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    Log in quickly with a 4-6 digit PIN code
                  </p>
                </div>
              </div>
              <Switch
                checked={authSettings?.pin_enabled ?? false}
                onCheckedChange={handlePinToggle}
                size="sm"
              />
            </div>

            {showPinSetup && (
              <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface-secondary/50 p-4 dark:border-border-dark dark:bg-surface-dark-secondary/50">
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Enter PIN (4-6 digits)
                  </Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter PIN"
                    className="font-mono text-sm tracking-widest"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 text-2xs text-text-secondary dark:text-text-dark-secondary">
                    Confirm PIN
                  </Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Confirm PIN"
                    className="font-mono text-sm tracking-widest"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handlePinSetup}
                    isLoading={setupLoading}
                  >
                    Save PIN
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowPinSetup(false);
                      setPin('');
                      setConfirmPin('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-4 dark:border-border-dark">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                  <Mail className="h-4 w-4 text-text-secondary dark:text-text-dark-secondary" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    Passwordless Login
                  </h3>
                  <p className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    Log in with a one-time code sent to your email
                  </p>
                </div>
              </div>
              <Switch
                checked={authSettings?.passwordless_enabled ?? false}
                onCheckedChange={handlePasswordlessToggle}
                size="sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
