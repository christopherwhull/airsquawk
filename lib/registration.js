// lib/registration.js

// This is a simplified version of the logic from the old server
// It can be expanded later if needed
function registration_from_hexid(hexid) {
    if (!hexid) return null;
    
    // Basic logic for US registrations
    const hexVal = parseInt(hexid, 16);
    if (hexVal >= 0xA00001 && hexVal <= 0xADF7C7) {
        return `N${hexVal - 0xA00000}`;
    }
    return null;
}

module.exports = { registration_from_hexid };
