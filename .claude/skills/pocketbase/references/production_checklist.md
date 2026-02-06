# PocketBase Production Deployment Checklist

Comprehensive checklist for deploying PocketBase to production safely and securely.

## Pre-Deployment Security

### 1. Settings Encryption

- [ ] Enable settings encryption: Dashboard > Settings > Application > "Encrypt settings"
- [ ] Verify encryption is enabled BEFORE entering production credentials
- [ ] Understand: SMTP passwords and S3 credentials are stored as plaintext by default

### 2. Authentication & Authorization

- [ ] Enable MFA for `_superusers` collection (Settings > Collections > \_superusers > Options)
- [ ] Create non-superuser admin accounts for routine operations
- [ ] Review all collection API rules (list, view, create, update, delete)
- [ ] Test API rules with regular user accounts (NOT superusers - they bypass rules!)
- [ ] Verify `@request.auth` checks are in place where needed
- [ ] Confirm no collections accidentally have `null` rules (public access)

### 3. Rate Limiting

- [ ] Enable built-in rate limiter: Dashboard > Settings > Application
- [ ] Configure rate limits for:
  - Auth endpoints (prevent brute force)
  - Record creation (prevent spam)
  - File uploads (prevent abuse)
- [ ] Consider additional reverse proxy rate limiting for advanced needs

### 4. File Security

- [ ] Review file field settings for max upload size (default: 5MB, max: ~8GB)
- [ ] Enable "Protected" option for sensitive file fields
- [ ] Implement server-side file type validation in hooks (not just client-side)
- [ ] Set appropriate `viewRule` for collections with protected files
- [ ] Test file token authentication if using protected files

### 5. API Rules Testing

- [ ] Test each collection's rules with different user roles
- [ ] Verify ownership checks work (`@request.auth.id = owner`)
- [ ] Test relationship-based permissions (`team.owner = @request.auth.id`)
- [ ] Confirm field validation rules (`@request.body.*` checks)
- [ ] Test edge cases (unauthenticated, wrong user, admin)

### 6. Hooks Review

- [ ] Review all hooks in `pb_hooks/*.pb.js` files
- [ ] Verify all hooks call `e.next()` appropriately
- [ ] Check for infinite loop prevention (conditional guards)
- [ ] Confirm no use of `unsafeWithoutHooks()` (bypasses validations)
- [ ] Test hooks trigger correctly for their target collections
- [ ] Verify email/notification hooks use `*AfterSuccess` hooks

## Infrastructure Setup

### 7. HTTPS Configuration

- [ ] Choose deployment method:
  - [ ] PocketBase auto-managed TLS (`./pocketbase serve --https domain.com:443`)
  - [ ] Reverse proxy (nginx, caddy, traefik)
- [ ] Verify SSL certificate is valid and not expired
- [ ] Test HTTPS redirects from HTTP
- [ ] Configure SSL/TLS security headers

### 8. Reverse Proxy (if using)

- [ ] Configure reverse proxy to forward requests to PocketBase
- [ ] Set up proper headers (`X-Forwarded-For`, `X-Real-IP`)
- [ ] Whitelist IPs for `/api/admins/*` endpoints (admin access only)
- [ ] Configure timeouts appropriately for long-running requests
- [ ] Enable compression (gzip) if not already enabled

### 9. Firewall & Network Security

- [ ] Configure firewall to allow only necessary ports (443, 80)
- [ ] Block direct access to PocketBase port if using reverse proxy
- [ ] Set up fail2ban or similar for brute force protection
- [ ] Consider IP whitelisting for admin endpoints

### 10. Backup Strategy

- [ ] Set up automated backups of `pb_data` directory
- [ ] Schedule backups daily (or more frequently for critical data)
- [ ] Test backup restoration procedure
- [ ] Store backups in separate location (offsite/cloud)
- [ ] Document backup and restore procedures
- [ ] Set up backup monitoring/alerting

Example backup script:

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/pocketbase"
PB_DATA="/path/to/pb_data"

# Create backup directory
mkdir -p $BACKUP_DIR

# Stop PocketBase (optional, for transactional safety)
# systemctl stop pocketbase

# Backup pb_data
tar -czf $BACKUP_DIR/pb_data_$DATE.tar.gz -C $(dirname $PB_DATA) $(basename $PB_DATA)

# Start PocketBase
# systemctl start pocketbase

# Keep only last 30 days of backups
find $BACKUP_DIR -name "pb_data_*.tar.gz" -mtime +30 -delete
```

## Deployment

### 11. Environment Configuration

- [ ] Set production environment variables
- [ ] Configure logging level appropriately
- [ ] Set up log rotation
- [ ] Document environment-specific settings

### 12. Process Management

- [ ] Set up systemd service (or equivalent) for PocketBase
- [ ] Configure auto-restart on failure
- [ ] Set resource limits (memory, CPU)
- [ ] Enable service at boot

Example systemd service:

```ini
[Unit]
Description=PocketBase
After=network.target

[Service]
Type=simple
User=pocketbase
Group=pocketbase
WorkingDirectory=/opt/pocketbase
ExecStart=/opt/pocketbase/pocketbase serve --http=127.0.0.1:8090
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 13. Monitoring & Logging

- [ ] Set up application monitoring
- [ ] Configure error alerting
- [ ] Monitor disk space (database growth)
- [ ] Set up uptime monitoring
- [ ] Review logs location (Settings > Logs > Max days)

## Post-Deployment

### 14. Initial Testing

- [ ] Test all critical API endpoints
- [ ] Verify authentication flows work
- [ ] Test file uploads and downloads
- [ ] Check realtime subscriptions
- [ ] Verify webhooks/hooks execute correctly
- [ ] Test with multiple user types/roles

### 15. Security Verification

- [ ] Run security scan (SSL Labs, etc.)
- [ ] Verify rate limiting is working
- [ ] Test that admin endpoints are protected
- [ ] Confirm settings encryption is active
- [ ] Review security headers

### 16. Performance

- [ ] Establish baseline performance metrics
- [ ] Set up database indexing if needed
- [ ] Monitor response times
- [ ] Test under expected load

## Ongoing Maintenance

### 17. Regular Tasks

- [ ] Review logs weekly for errors/security issues
- [ ] Monitor backup success
- [ ] Review and rotate logs
- [ ] Update PocketBase when new versions release
- [ ] Review and update API rules as needed
- [ ] Audit user accounts and permissions

### 18. Update Procedure

- [ ] Backup before updating
- [ ] Review changelog for breaking changes
- [ ] Test updates in staging environment
- [ ] Plan maintenance window
- [ ] Document rollback procedure

### 19. Security Audits

- [ ] Quarterly review of API rules
- [ ] Review superuser accounts
- [ ] Audit file upload usage
- [ ] Check for deprecated/unused collections
- [ ] Review hook implementations

## Emergency Procedures

### 20. Incident Response

- [ ] Document rollback procedure
- [ ] Have backup restoration steps ready
- [ ] Keep emergency contact list
- [ ] Document common issues and solutions

### Rollback Procedure

```bash
# 1. Stop PocketBase
systemctl stop pocketbase

# 2. Backup current state (just in case)
mv pb_data pb_data_broken_$(date +%Y%m%d_%H%M%S)

# 3. Restore from backup
tar -xzf /backups/pb_data_YYYYMMDD_HHMMSS.tar.gz

# 4. Start PocketBase
systemctl start pocketbase

# 5. Verify functionality
curl https://your-domain.com/api/health
```

## Security Incident Checklist

If you suspect a security breach:

- [ ] Immediately enable MFA if not already enabled
- [ ] Review recent logs for suspicious activity
- [ ] Change superuser passwords
- [ ] Rotate API tokens if using programmatic access
- [ ] Review all recent changes to API rules and hooks
- [ ] Check for unauthorized file uploads
- [ ] Review and revoke suspicious auth sessions

## Additional Resources

- [Official PocketBase Production Docs](https://pocketbase.io/docs/going-to-production/)
- [PocketBase Security Discussions](https://github.com/pocketbase/pocketbase/discussions/categories/security)
- This skill's SKILL.md for development best practices

## Notes

- **Settings encryption**: Cannot be disabled once enabled (by design)
- **Backups**: Entire application state is in `pb_data` directory
- **Zero downtime**: Not natively supported; plan maintenance windows
- **Horizontal scaling**: PocketBase is single-instance; use reverse proxy for load balancing to multiple instances if needed (requires external session storage)
