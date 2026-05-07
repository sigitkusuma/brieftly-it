export async function getDetailedOS(): Promise<{ baseOS: 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'unknown', detailString: string | null }> {
  let baseOS: 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'unknown' = 'unknown';
  let detailString: string | null = null;
  
  if (typeof window === 'undefined') return { baseOS, detailString };

  const ua = window.navigator.userAgent || '';
  
  // Base detection first
  const lowerUa = ua.toLowerCase();
  
  if (lowerUa.includes('android')) {
    baseOS = 'android';
  } else if (lowerUa.includes('iphone') || lowerUa.includes('ipad') || lowerUa.includes('ipod')) {
    baseOS = 'ios';
  } else if (lowerUa.includes('mac')) {
    baseOS = 'macos';
  } else if (lowerUa.includes('win')) {
    baseOS = 'windows';
  } else if (lowerUa.includes('linux')) {
    baseOS = 'linux';
  }

  // Mac Codenames Helper
  const getMacCodename = (major: number, minor: number) => {
    if (major === 10) {
      switch (minor) {
        case 0: return 'Cheetah';
        case 1: return 'Puma';
        case 2: return 'Jaguar';
        case 3: return 'Panther';
        case 4: return 'Tiger';
        case 5: return 'Leopard';
        case 6: return 'Snow Leopard';
        case 7: return 'Lion';
        case 8: return 'Mountain Lion';
        case 9: return 'Mavericks';
        case 10: return 'Yosemite';
        case 11: return 'El Capitan';
        case 12: return 'Sierra';
        case 13: return 'High Sierra';
        case 14: return 'Mojave';
        case 15: return 'Catalina';
        default: return '';
      }
    } else {
      switch (major) {
        case 11: return 'Big Sur';
        case 12: return 'Monterey';
        case 13: return 'Ventura';
        case 14: return 'Sonoma';
        case 15: return 'Sequoia';
        default: return '';
      }
    }
  };

  // Modern Client Hint Detection
  if ('userAgentData' in navigator) {
    try {
      const uad = (navigator as any).userAgentData;
      const values = await uad.getHighEntropyValues(['platform', 'platformVersion']);
      
      if (values.platform.toLowerCase() === 'android') {
        baseOS = 'android';
        detailString = `Android ${values.platformVersion || ''}`.trim();
      } else if (values.platform.toLowerCase() === 'macos') {
        baseOS = 'macos';
        if (values.platformVersion) {
          const parts = values.platformVersion.split('.');
          const major = parseInt(parts[0], 10);
          const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          const codename = getMacCodename(major, minor);
          detailString = `macOS ${values.platformVersion} ${codename ? `(${codename})` : ''}`.trim();
        }
      } else if (values.platform.toLowerCase() === 'windows') {
        baseOS = 'windows';
        if (values.platformVersion) {
          const major = parseInt(values.platformVersion.split('.')[0], 10);
          // Windows 11 platformVersion is usually 13+ or 14+
          const winName = major >= 13 ? 'Windows 11' : 'Windows 10';
          detailString = `${winName} (Build ${values.platformVersion})`;
        }
      } else if (values.platform.toLowerCase() === 'linux') {
        baseOS = 'linux';
        detailString = 'Linux';
      }
    } catch (e) {
      console.warn("Could not get high entropy values", e);
    }
  }

  // Fallback to parsing User Agent String if detailString is still null
  if (!detailString) {
    if (baseOS === 'macos') {
      const macMatch = ua.match(/Mac OS X ([0-9_]+)/);
      if (macMatch) {
        const versionRaw = macMatch[1].replace(/_/g, '.');
        const parts = versionRaw.split('.');
        const major = parseInt(parts[0], 10);
        const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        const codename = getMacCodename(major, minor);
        detailString = `macOS ${versionRaw} ${codename ? `(${codename})` : ''}`.trim();
      } else {
        detailString = 'macOS';
      }
    } else if (baseOS === 'windows') {
      const winMatch = ua.match(/Windows NT ([0-9.]+)/);
      if (winMatch) {
        const version = winMatch[1];
        if (version === '10.0') detailString = 'Windows 10 / 11'; // Can't easily tell Win 11 from UA alone
        else if (version === '6.3') detailString = 'Windows 8.1';
        else if (version === '6.2') detailString = 'Windows 8';
        else if (version === '6.1') detailString = 'Windows 7';
        else detailString = `Windows NT ${version}`;
      } else {
        detailString = 'Windows';
      }
    } else if (baseOS === 'linux') {
      detailString = 'Linux';
    } else if (baseOS === 'android') {
      const androidMatch = ua.match(/Android ([0-9.]+)/i);
      if (androidMatch) {
         detailString = `Android ${androidMatch[1]}`;
      } else {
         detailString = 'Android';
      }
    } else if (baseOS === 'ios') {
      const iosMatch = ua.match(/OS ([0-9_]+) like Mac OS X/i);
      if (iosMatch) {
        detailString = `iOS ${iosMatch[1].replace(/_/g, '.')}`;
      } else {
        detailString = 'iOS';
      }
    } else {
       detailString = 'Unknown OS';
    }
  }

  return { baseOS, detailString };
}
