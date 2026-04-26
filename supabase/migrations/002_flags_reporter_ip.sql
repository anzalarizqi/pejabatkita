-- Add reporter IP hash for rate-limiting public flags (privacy-safe: hashed, not raw IP)
ALTER TABLE flags ADD COLUMN reporter_ip_hash varchar;
CREATE INDEX idx_flags_reporter_ip ON flags(reporter_ip_hash);
