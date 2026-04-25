import { useState } from 'react';
import { useAuth } from '@tools/auth';
import LoginScreen from './components/LoginScreen';
import StoryList from './components/StoryList';
import StoryEditor from './components/StoryEditor';
import './App.css';

const AUTH_CONFIG = {
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
};

export default function App() {
  const { user, isLoading: authLoading, signIn, signOut, completeNewPasswordChallenge } = useAuth(AUTH_CONFIG);
  const [activeStoryId, setActiveStoryId] = useState(null);

  if (authLoading) {
    return <div className="app-loading"><p>Loading…</p></div>;
  }

  if (!user) {
    return <LoginScreen onSignIn={signIn} onCompleteNewPassword={completeNewPasswordChallenge} />;
  }

  if (activeStoryId) {
    return (
      <StoryEditor
        storyId={activeStoryId}
        onBack={() => setActiveStoryId(null)}
      />
    );
  }

  return (
    <StoryList
      user={user}
      onSignOut={signOut}
      onOpenStory={setActiveStoryId}
    />
  );
}
