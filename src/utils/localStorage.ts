/**
 * SECURITY FIX: Secure localStorage utilities with validation and checksums
 * Prevents malicious script injection and data corruption
 */

// Type definitions for stored data
export interface StoredLPPosition {
  id: string;
  owner: string;
  baseToken: string;
  baseAmount: number;
  usdcAmount: number;
  entryPrice: number;
  entryExchangeRate?: number; // Crucible exchange rate at position open for real yield tracking
  currentValue: number;
  yieldEarned: number;
  isOpen: boolean;
  lpAPY?: number;
  pnl?: number;
  nonce?: number; // Position nonce for PDA derivation (allows multiple positions)
}

export interface StoredInfernoLPPosition extends StoredLPPosition {
  borrowedUSDC: number;
  leverageFactor: number;
  lpTokenAmount?: number; // Actual LP tokens in wallet
  nonce?: number; // Position nonce for PDA derivation
}

export interface StoredLeveragedPosition {
  id: string;
  owner: string;
  token: string;
  collateral: number;
  borrowedUSDC: number;
  depositUSDC?: number;
  leverageFactor: number;
  entryPrice: number;
  entryExchangeRate?: number; // Crucible exchange rate at position open for real yield tracking
  currentValue: number;
  yieldEarned: number;
  timestamp?: number;
  isOpen: boolean;
  health?: number;
}

export interface StoredLendingSupplyPosition {
  id: string;
  owner: string;
  marketPubkey: string;
  baseMint: string;
  suppliedAmount: number; // Original amount supplied
  timestamp: number; // When position was opened
  effectiveApy: number; // APY after fees
  isOpen: boolean;
}

// Simple checksum function (using string hash for validation)
function generateChecksum(data: string): string {
  // Use a simple hash function (in production, consider using crypto.subtle)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Validate LP position structure
function validateLPPosition(position: any): position is StoredLPPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    typeof position.id === 'string' &&
    typeof position.owner === 'string' &&
    typeof position.baseToken === 'string' &&
    typeof position.baseAmount === 'number' &&
    typeof position.usdcAmount === 'number' &&
    typeof position.entryPrice === 'number' &&
    typeof position.currentValue === 'number' &&
    typeof position.yieldEarned === 'number' &&
    typeof position.isOpen === 'boolean' &&
    position.id.length > 0 &&
    position.owner.length > 0 &&
    position.baseAmount >= 0 &&
    position.usdcAmount >= 0 &&
    position.entryPrice > 0
  );
}

function validateInfernoLPPosition(position: any): position is StoredInfernoLPPosition {
  if (!validateLPPosition(position)) {
    return false;
  }

  const infernoPosition = position as StoredInfernoLPPosition;
  return (
    typeof infernoPosition.borrowedUSDC === 'number' &&
    typeof infernoPosition.leverageFactor === 'number' &&
    infernoPosition.borrowedUSDC >= 0 &&
    infernoPosition.leverageFactor >= 1
  );
}

// Validate leveraged position structure
function validateLeveragedPosition(position: any): position is StoredLeveragedPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    typeof position.id === 'string' &&
    typeof position.owner === 'string' &&
    typeof position.token === 'string' &&
    typeof position.collateral === 'number' &&
    typeof position.borrowedUSDC === 'number' &&
    typeof position.leverageFactor === 'number' &&
    typeof position.entryPrice === 'number' &&
    typeof position.currentValue === 'number' &&
    typeof position.yieldEarned === 'number' &&
    typeof position.isOpen === 'boolean' &&
    position.id.length > 0 &&
    position.owner.length > 0 &&
    position.collateral >= 0 &&
    position.borrowedUSDC >= 0 &&
    position.leverageFactor >= 1 &&
    position.entryPrice > 0
  );
}

/**
 * SECURITY FIX: Safely get and parse LP positions from localStorage
 */
export function getLPPositions(): StoredLPPosition[] {
  try {
    const stored = localStorage.getItem('lp_positions');
    if (!stored) return [];
    
    // Check for checksum if present
    const checksumKey = 'lp_positions_checksum';
    const expectedChecksum = localStorage.getItem(checksumKey);
    if (expectedChecksum) {
      const actualChecksum = generateChecksum(stored);
      if (actualChecksum !== expectedChecksum) {
        console.warn('⚠️ localStorage checksum mismatch for lp_positions - data may be corrupted');
        return [];
      }
    }
    
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Invalid localStorage data format for lp_positions');
      return [];
    }
    
    // Validate each position
    const validPositions = parsed.filter(validateLPPosition);
    if (validPositions.length !== parsed.length) {
      console.warn(`⚠️ Filtered out ${parsed.length - validPositions.length} invalid LP positions`);
    }
    
    return validPositions;
  } catch (error) {
    console.warn('Failed to load LP positions from localStorage:', error);
    return [];
  }
}

/**
 * SECURITY FIX: Safely set LP positions to localStorage with checksum
 */
export function setLPPositions(positions: StoredLPPosition[]): void {
  try {
    // Validate all positions before storing
    const validPositions = positions.filter(validateLPPosition);
    if (validPositions.length !== positions.length) {
      console.warn(`⚠️ Filtered out ${positions.length - validPositions.length} invalid LP positions before storing`);
    }
    
    const serialized = JSON.stringify(validPositions);
    const checksum = generateChecksum(serialized);
    
    localStorage.setItem('lp_positions', serialized);
    localStorage.setItem('lp_positions_checksum', checksum);
  } catch (error) {
    console.error('Failed to store LP positions to localStorage:', error);
    throw error;
  }
}

export function getInfernoLPPositions(): StoredInfernoLPPosition[] {
  try {
    const stored = localStorage.getItem('inferno_lp_positions');
    if (!stored) return [];

    const checksumKey = 'inferno_lp_positions_checksum';
    const expectedChecksum = localStorage.getItem(checksumKey);
    if (expectedChecksum) {
      const actualChecksum = generateChecksum(stored);
      if (actualChecksum !== expectedChecksum) {
        console.warn('⚠️ localStorage checksum mismatch for inferno_lp_positions - data may be corrupted');
        return [];
      }
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Invalid localStorage data format for inferno_lp_positions');
      return [];
    }

    const validPositions = parsed.filter(validateInfernoLPPosition);
    if (validPositions.length !== parsed.length) {
      console.warn(`⚠️ Filtered out ${parsed.length - validPositions.length} invalid Inferno LP positions`);
    }

    return validPositions;
  } catch (error) {
    console.warn('Failed to load Inferno LP positions from localStorage:', error);
    return [];
  }
}

export function setInfernoLPPositions(positions: StoredInfernoLPPosition[]): void {
  try {
    const validPositions = positions.filter(validateInfernoLPPosition);
    if (validPositions.length !== positions.length) {
      console.warn(`⚠️ Filtered out ${positions.length - validPositions.length} invalid Inferno LP positions before storing`);
    }

    const serialized = JSON.stringify(validPositions);
    const checksum = generateChecksum(serialized);

    localStorage.setItem('inferno_lp_positions', serialized);
    localStorage.setItem('inferno_lp_positions_checksum', checksum);
  } catch (error) {
    console.error('Failed to store Inferno LP positions to localStorage:', error);
    throw error;
  }
}

/**
 * SECURITY FIX: Safely get and parse leveraged positions from localStorage
 */
export function getLeveragedPositions(): StoredLeveragedPosition[] {
  try {
    const stored = localStorage.getItem('leveraged_positions');
    if (!stored) return [];
    
    // Check for checksum if present
    const checksumKey = 'leveraged_positions_checksum';
    const expectedChecksum = localStorage.getItem(checksumKey);
    if (expectedChecksum) {
      const actualChecksum = generateChecksum(stored);
      if (actualChecksum !== expectedChecksum) {
        console.warn('⚠️ localStorage checksum mismatch for leveraged_positions - data may be corrupted');
        return [];
      }
    }
    
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Invalid localStorage data format for leveraged_positions');
      return [];
    }
    
    // Validate each position
    const validPositions = parsed.filter(validateLeveragedPosition);
    if (validPositions.length !== parsed.length) {
      console.warn(`⚠️ Filtered out ${parsed.length - validPositions.length} invalid leveraged positions`);
    }
    
    return validPositions;
  } catch (error) {
    console.warn('Failed to load leveraged positions from localStorage:', error);
    return [];
  }
}

/**
 * SECURITY FIX: Safely set leveraged positions to localStorage with checksum
 */
export function setLeveragedPositions(positions: StoredLeveragedPosition[]): void {
  try {
    // Validate all positions before storing
    const validPositions = positions.filter(validateLeveragedPosition);
    if (validPositions.length !== positions.length) {
      console.warn(`⚠️ Filtered out ${positions.length - validPositions.length} invalid leveraged positions before storing`);
    }
    
    const serialized = JSON.stringify(validPositions);
    const checksum = generateChecksum(serialized);
    
    localStorage.setItem('leveraged_positions', serialized);
    localStorage.setItem('leveraged_positions_checksum', checksum);
  } catch (error) {
    console.error('Failed to store leveraged positions to localStorage:', error);
    throw error;
  }
}

// Validate lending supply position structure
function validateLendingSupplyPosition(position: any): position is StoredLendingSupplyPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    typeof position.id === 'string' &&
    typeof position.owner === 'string' &&
    typeof position.marketPubkey === 'string' &&
    typeof position.baseMint === 'string' &&
    typeof position.suppliedAmount === 'number' &&
    typeof position.timestamp === 'number' &&
    typeof position.effectiveApy === 'number' &&
    typeof position.isOpen === 'boolean' &&
    position.id.length > 0 &&
    position.owner.length > 0 &&
    position.suppliedAmount >= 0 &&
    position.timestamp > 0
  );
}

/**
 * Get lending supply positions from localStorage
 */
export function getLendingSupplyPositions(): StoredLendingSupplyPosition[] {
  try {
    const stored = localStorage.getItem('lending_supply_positions');
    if (!stored) return [];
    
    const checksumKey = 'lending_supply_positions_checksum';
    const expectedChecksum = localStorage.getItem(checksumKey);
    if (expectedChecksum) {
      const actualChecksum = generateChecksum(stored);
      if (actualChecksum !== expectedChecksum) {
        console.warn('⚠️ localStorage checksum mismatch for lending_supply_positions - data may be corrupted');
        return [];
      }
    }
    
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      console.warn('⚠️ Invalid localStorage data format for lending_supply_positions');
      return [];
    }
    
    const validPositions = parsed.filter(validateLendingSupplyPosition);
    if (validPositions.length !== parsed.length) {
      console.warn(`⚠️ Filtered out ${parsed.length - validPositions.length} invalid lending supply positions`);
    }
    
    return validPositions;
  } catch (error) {
    console.warn('Failed to load lending supply positions from localStorage:', error);
    return [];
  }
}

/**
 * Set lending supply positions to localStorage
 */
export function setLendingSupplyPositions(positions: StoredLendingSupplyPosition[]): void {
  try {
    const validPositions = positions.filter(validateLendingSupplyPosition);
    if (validPositions.length !== positions.length) {
      console.warn(`⚠️ Filtered out ${positions.length - validPositions.length} invalid lending supply positions before storing`);
    }
    
    const serialized = JSON.stringify(validPositions);
    const checksum = generateChecksum(serialized);
    
    localStorage.setItem('lending_supply_positions', serialized);
    localStorage.setItem('lending_supply_positions_checksum', checksum);
  } catch (error) {
    console.error('Failed to store lending supply positions to localStorage:', error);
    throw error;
  }
}
