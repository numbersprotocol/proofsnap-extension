import React, { useState, useEffect, useRef } from 'react';
import { getNumbersApi } from '../services/NumbersApiManager';
import { storageService } from '../services/StorageService';

/**
 * Evaluate password strength (0 = too weak, 1 = weak, 2 = fair, 3 = strong, 4 = very strong)
 */
function getPasswordStrength(password: string): { score: number; label: string } {
    if (password.length === 0) return { score: 0, label: '' };
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    const labels = ['', 'Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
    return { score, label: labels[score] || '' };
}

const RATE_LIMIT_DELAYS = [0, 5, 10, 30, 60]; // Delay in seconds after N login failures: [0th=0s, 1st=5s, 2nd=10s, 3rd=30s, 4th+=60s]

const AuthForm: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    const [isLoginMode, setIsLoginMode] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loginFailures, setLoginFailures] = useState(0);
    const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
    const [rateLimitRemaining, setRateLimitRemaining] = useState(0);
    const rateLimitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // Check for persisted errors (e.g. from background Google Auth)
    useEffect(() => {
        storageService.getAndClearGoogleAuthError().then(err => {
            if (err) {
                setError(err);
            }
        });
    }, []);

    // Countdown timer for rate limiting
    useEffect(() => {
        if (rateLimitUntil === null) return;
        const tick = () => {
            const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
            if (remaining <= 0) {
                setRateLimitUntil(null);
                setRateLimitRemaining(0);
                if (rateLimitTimer.current) {
                    clearInterval(rateLimitTimer.current);
                    rateLimitTimer.current = null;
                }
            } else {
                setRateLimitRemaining(remaining);
            }
        };
        tick();
        rateLimitTimer.current = setInterval(tick, 1000);
        return () => {
            if (rateLimitTimer.current) clearInterval(rateLimitTimer.current);
        };
    }, [rateLimitUntil]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Enforce rate limiting on login
        if (isLoginMode && rateLimitUntil !== null && Date.now() < rateLimitUntil) {
            setError(`Too many failed attempts. Please wait ${rateLimitRemaining} second${rateLimitRemaining === 1 ? '' : 's'} before trying again.`);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const numbersApi = await getNumbersApi();

            if (isLoginMode) {
                await numbersApi.login(email, password);
                setLoginFailures(0);
            } else {
                await numbersApi.signup(email, password);
            }
            onLogin();
        } catch (err: any) {
            console.error('Auth error:', err);
            setError(err.message || (isLoginMode ? 'Login failed.' : 'Signup failed.'));

            // Apply progressive rate limiting on login failures
            if (isLoginMode) {
                const newFailures = loginFailures + 1;
                setLoginFailures(newFailures);
                const delayIndex = Math.min(newFailures, RATE_LIMIT_DELAYS.length - 1);
                const delaySec = RATE_LIMIT_DELAYS[delayIndex];
                if (delaySec > 0) {
                    setRateLimitUntil(Date.now() + delaySec * 1000);
                }
            }
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

    const passwordStrength = !isLoginMode ? getPasswordStrength(password) : null;
    const isRateLimited = isLoginMode && rateLimitUntil !== null && Date.now() < rateLimitUntil;

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
                {!isLoginMode && passwordStrength && passwordStrength.score > 0 && (
                    <div className="password-strength">
                        <div
                            className={`password-strength-bar strength-${passwordStrength.score}`}
                            style={{ width: `${passwordStrength.score * 20}%` }}
                        />
                        <span className="password-strength-label">{passwordStrength.label}</span>
                    </div>
                )}
                {!isLoginMode && (
                    <p className="password-requirements">
                        Password must be at least 8 characters and include uppercase, lowercase, number, and special character.
                    </p>
                )}

                <button type="submit" disabled={loading || isRateLimited} className="auth-submit-button">
                    {isRateLimited
                        ? `Wait ${rateLimitRemaining}s`
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
