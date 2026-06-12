alter table balance_adjustment_log
  add constraint balance_adjustment_log_reason_check
  check (reason in ('manual_adjustment', 'request_approved', 'record_created'));
