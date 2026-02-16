'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { cognitoConfig } from '../config/config';
import { setAuthTokenResolver } from '../services/api';

// ---------- Cognito pool singleton ----------
const userPool = new CognitoUserPool({
  UserPoolId: cognitoConfig.userPoolId,
  ClientId: cognitoConfig.userPoolClientId,
});

// ---------- Types ----------
interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: CognitoUser | null;
  userEmail: string | null;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<{ userConfirmed: boolean }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  signOut: () => void;
  getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------- Provider ----------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    userEmail: null,
  });

  // --- Get ID Token (for AWS credential exchange) ---
  const getIdToken = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const currentUser = userPool.getCurrentUser();
      if (!currentUser) return reject(new Error('No authenticated user'));

      currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) return reject(err ?? new Error('Invalid session'));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }, []);

  // Check for an existing session on mount
  useEffect(() => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      // No stored session — mark as not authenticated
      // Using callback in getSession pattern to avoid sync setState in effect
      queueMicrotask(() => {
        setAuthState({ isAuthenticated: false, isLoading: false, user: null, userEmail: null });
      });
      return;
    }

    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        setAuthTokenResolver(null);
        setAuthState({ isAuthenticated: false, isLoading: false, user: null, userEmail: null });
      } else {
        const email =
          session.getIdToken().payload?.email ?? currentUser.getUsername();
        setAuthTokenResolver(getIdToken);
        setAuthState({
          isAuthenticated: true,
          isLoading: false,
          user: currentUser,
          userEmail: email as string,
        });
      }
    });
  }, [getIdToken]);

  // --- Sign In ---
  const signIn = useCallback(async (email: string, password: string) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    return new Promise<void>((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          const userEmail =
            session.getIdToken().payload?.email ?? cognitoUser.getUsername();
          setAuthTokenResolver(getIdToken);
          setAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: cognitoUser,
            userEmail: userEmail as string,
          });
          resolve();
        },
        onFailure: (err) => reject(err),
      });
    });
  }, [getIdToken]);

  // --- Sign Up ---
  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const attributes = [
      new CognitoUserAttribute({ Name: 'email', Value: email }),
      new CognitoUserAttribute({ Name: 'name', Value: name }),
    ];

    return new Promise<{ userConfirmed: boolean }>((resolve, reject) => {
      userPool.signUp(email, password, attributes, [], (err, result) => {
        if (err) return reject(err);
        resolve({ userConfirmed: result?.userConfirmed ?? false });
      });
    });
  }, []);

  // --- Confirm Sign Up ---
  const confirmSignUp = useCallback(async (email: string, code: string) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    return new Promise<void>((resolve, reject) => {
      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }, []);

  // --- Resend Confirmation ---
  const resendConfirmation = useCallback(async (email: string) => {
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    return new Promise<void>((resolve, reject) => {
      cognitoUser.resendConfirmationCode((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }, []);

  // --- Sign Out ---
  const signOut = useCallback(() => {
    const currentUser = userPool.getCurrentUser();
    if (currentUser) currentUser.signOut();
    setAuthTokenResolver(null);
    setAuthState({ isAuthenticated: false, isLoading: false, user: null, userEmail: null });
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...authState, signIn, signUp, confirmSignUp, resendConfirmation, signOut, getIdToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------- Hook ----------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
