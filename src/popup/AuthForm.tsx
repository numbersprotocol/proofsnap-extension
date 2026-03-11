import React, { useState, useEffect } from 'react';
import { getNumbersApi } from '../services/NumbersApiManager';
import { storageService } from '../services/StorageService';

/** Minimum consecutive failed auth attempts before a cooldown is enforced. */
const RATE_LIMIT_THRESHOLD = 3;

/**
 * Returns a human-readable error string if the password doesn't meet the
 * minimum requirements for signup, or null if it passes.
 */
function validatePasswordStrength(password: string): string | null {
    if (password.length < 8) {
        return 'Password must be at least 8 characters.';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password must contain at least one uppercase letter.';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password must contain at least one lowercase letter.';
    }
    if (!/[0-9!@#$%^&*()\-_=+[\]{};:'",.<>?/\\|`~]/.test(password)) {
        return 'Password must contain at least one number or special character.';
    }
    return null;
}

/**
 * Returns a strength label and colour for a password.
 * Used to render the inline strength indicator in signup mode.
 */
function getPasswordStrength(password: string): { label: string; color: string } | null {
    if (!password) return null;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*()\-_=+[\]{};:'",.<>?/\\|`~]/.test(password)) score++;

    if (score <= 2) return { label: 'Weak', color: '#ef4444' };
    if (score === 3) return { label: 'Fair', color: '#f59e0b' };
    if (score === 4) return { label: 'Good', color: '#3b82f6' };
    return { label: 'Strong', color: '#22c55e' };
}

const AuthForm: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    const [isLoginMode, setIsLoginMode] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Rate-limiting state
    const [failedAttempts, setFailedAttempts] = useState(0);
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const [cooldownRemaining, setCooldownRemaining] = useState(0);

    // Check for persisted errors (e.g. from background Google Auth)
    useEffect(() => {
        storageService.getAndClearGoogleAuthError().then(err => {
            if (err) {
                setError(err);
            }
        });
    }, []);

    // Countdown ticker for the rate-limit cooldown
    useEffect(() => {
        if (!cooldownUntil) return;
        const interval = setInterval(() => {
            const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
            if (remaining <= 0) {
                setCooldownUntil(null);
                setCooldownRemaining(0);
                clearInterval(interval);
            } else {
                setCooldownRemaining(remaining);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [cooldownUntil]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Enforce rate-limiting cooldown
        if (cooldownUntil && Date.now() < cooldownUntil) {
            setError(`Too many failed attempts. Please wait ${cooldownRemaining} second${cooldownRemaining !== 1 ? 's' : ''} before trying again.`);
            return;
        }

        // Client-side password strength check for signup
        if (!isLoginMode) {
            const pwdError = validatePasswordStrength(password);
            if (pwdError) {
                setError(pwdError);
                return;
            }
        }

        setLoading(true);
        setError('');

        try {
            const numbersApi = await getNumbersApi();

            if (isLoginMode) {
                await numbersApi.login(email, password);
            } else {
                await numbersApi.signup(email, password);
            }
            setFailedAttempts(0);
            setCooldownUntil(null);
            onLogin();
        } catch (err: any) {
            console.error('Auth error:', err);

            // Increment failure counter and apply exponential backoff when the
            // threshold is exceeded: 5 s, 10 s, 20 s, 40 s …
            const newFailedAttempts = failedAttempts + 1;
            setFailedAttempts(newFailedAttempts);
            if (newFailedAttempts >= RATE_LIMIT_THRESHOLD) {
                const cooldownSeconds = Math.pow(2, newFailedAttempts - RATE_LIMIT_THRESHOLD) * 5;
                const until = Date.now() + cooldownSeconds * 1000;
                setCooldownUntil(until);
                setCooldownRemaining(cooldownSeconds);
            }

            setError(err.message || (isLoginMode ? 'Login failed.' : 'Signup failed.'));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        setLoading(true);
        setError('');

        // Google Auth launches an interactive window which closes this popup.
        // We delegate the flow to the background script so it survives.
        try {
            // Send message to background script
            const response = await chrome.runtime.sendMessage({ type: 'START_GOOGLE_AUTH' });

            // Check if message sending failed (e.g. background script not ready)
            if (chrome.runtime.lastError) {
                throw new Error('Failed to communicate with background service: ' + chrome.runtime.lastError.message);
            }

            if (!response || !response.success) {
                throw new Error(response?.error || 'Google Auth failed');
            }

            // If we got a success response here, it means the auth flow finished
            // AND we are still alive (which happens if the auth window didn't steal focus entirely
            // or if we are exploring in a persistent view).
            // In standard popup usage, the popup closes before this returns,
            // so the user will simply re-open the popup and be logged in.
            onLogin();
        } catch (err: any) {
            console.error('Google Auth error:', err);
            // If popup was closed during auth, this error won't be seen by user,
            // but it's good for debugging if inspecting.
            setError(err.message || 'Google Authentication failed.');
        } finally {
            setLoading(false);
        }
    };

    const strengthInfo = !isLoginMode ? getPasswordStrength(password) : null;
    const isInCooldown = cooldownUntil !== null && Date.now() < cooldownUntil;

    return (
        <div className="auth-container">
            <div className="auth-tabs">
                <button
                    onClick={() => setIsLoginMode(true)}
                    className={`auth-tab ${isLoginMode ? 'active' : ''}`}
                >
                    Login
                </button>
                <button
                    onClick={() => setIsLoginMode(false)}
                    className={`auth-tab ${!isLoginMode ? 'active' : ''}`}
                >
                    Sign Up
                </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="auth-input"
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="auth-input"
                />

                {/* Password strength indicator (signup only) */}
                {strengthInfo && (
                    <div className="password-strength">
                        <div className="password-strength-bar">
                            <div
                                className="password-strength-fill"
                                style={{ backgroundColor: strengthInfo.color, width: strengthInfo.label === 'Weak' ? '25%' : strengthInfo.label === 'Fair' ? '50%' : strengthInfo.label === 'Good' ? '75%' : '100%' }}
                            />
                        </div>
                        <span className="password-strength-label" style={{ color: strengthInfo.color }}>
                            {strengthInfo.label}
                        </span>
                    </div>
                )}

                {/* Password requirements hint (signup only) */}
                {!isLoginMode && (
                    <p className="password-hint">
                        Min. 8 characters with uppercase, lowercase, and a number or symbol.
                    </p>
                )}

                <button type="submit" disabled={loading || isInCooldown} className="auth-submit-button">
                    {isInCooldown
                        ? `Try again in ${cooldownRemaining}s`
                        : loading
                            ? (isLoginMode ? 'Logging in...' : 'Signing up...')
                            : (isLoginMode ? 'Login' : 'Sign Up')}
                </button>
            </form>

            <div className="auth-divider">
                <div className="auth-divider-line">
                    <span className="auth-divider-text">OR</span>
                </div>
                <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={loading}
                    className="google-auth-button"
                >
                    {/* Simple Google Icon SVG */}
                    <svg width="18" height="18" viewBox="0 0 18 18">
                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"></path><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.715H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"></path><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"></path><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"></path>
                    </svg>
                    Continue with Google
                </button>
            </div>

            {error && <div className="auth-error">{error}</div>}
        </div>
    );
};

export default AuthForm;
