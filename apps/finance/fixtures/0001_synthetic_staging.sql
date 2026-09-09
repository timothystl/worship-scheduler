-- Synthetic staging data only. Never use this file with a production database.
INSERT INTO finance_settings (key,value,updated_at) VALUES
  ('fixture_label','SYNTHETIC-NO-PRODUCTION-DATA','2026-01-01T00:00:00Z'),
  ('fiscal_year_start_month','1','2026-01-01T00:00:00Z');
INSERT INTO finance_church_entries (fiscal_year,period_month,classification,category_path,account_name,own_actual_cents,own_budget_cents,source,synced_at) VALUES
  (2026,0,'Income','Income:Synthetic Contributions','Synthetic Contributions',12000000,12500000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2026,0,'Expenses','Expenses:Synthetic Programs','Synthetic Programs',8000000,8500000,'synthetic_fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_church_balances (fiscal_year,as_of_date,classification,category_path,account_name,own_balance_cents,source,synced_at) VALUES
  (2026,'2026-12-31','Assets','Assets:Synthetic Cash','Synthetic Cash',30000000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2026,'2026-12-31','Liabilities','Liabilities:Synthetic Note','Synthetic Note',10000000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2026,'2026-12-31','Equity','Equity:Synthetic Net Assets','Synthetic Net Assets',20000000,'synthetic_fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_property_monthly (property_key,period,occupancy_pct,total_revenue_cents,total_expenses_cents,net_income_cents,net_operating_income_cents,available_for_distribution_cents,reserve_balance_cents,source_report,updated_at) VALUES
  ('synthetic-property','2026-01',90,2000000,1200000,800000,900000,500000,2500000,'synthetic_fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_property_distributions (property_key,period,amount_cents) VALUES ('synthetic-property','2026-01',500000);
INSERT INTO finance_property_reserves (property_key,reserve_key,report_month,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note) VALUES
  ('synthetic-property','property_tax','2026-01',6000000,2000000,500000,2500000,'Synthetic fixture');
INSERT INTO finance_property_reserve_disbursements (property_key,reserve_key,period_key,amount_cents,note) VALUES
  ('synthetic-property','property_tax','2026-demo',0,'Synthetic fixture');
INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,payee,description,project) VALUES
  ('synthetic-property','2026-01-15',100000,'Synthetic Vendor','Synthetic capital project','Synthetic Project');
INSERT INTO finance_property_repairs (property_key,entry_date,category,description,amount_cents,payee) VALUES
  ('synthetic-property','2026-01-20','Synthetic repair','Synthetic repair item',25000,'Synthetic Vendor');
INSERT INTO finance_property_budget_monthly (property_key,period,revenue_cents,expenses_cents,net_income_cents,source,updated_at) VALUES
  ('synthetic-property','2026-01',2100000,1250000,850000,'synthetic_fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_budget_plan (category,fiscal_year,planned_amount_cents,basis,notes,updated_at) VALUES
  ('Synthetic Programs',2027,9000000,'synthetic_fixture','Synthetic fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source,created_at) VALUES
  ('2026-01','Synthetic Tuition','actual',4000000,'Synthetic fixture','synthetic_fixture','2026-01-01T00:00:00Z'),
  ('2026-01','Synthetic Labor','actual',2500000,'Synthetic fixture','synthetic_fixture','2026-01-01T00:00:00Z');
INSERT INTO finance_daycare_rooms (period,room_name,capacity_per_day,avg_daily_enrolled,billed_cents,labor_cost_cents,waitlist_families,synced_at) VALUES
  ('2026-01','Synthetic Room',10,8,4000000,2500000,2,'2026-01-01T00:00:00Z');
INSERT INTO finance_import_log (importer_key,last_imported_at,note) VALUES
  ('synthetic_fixture','2026-01-01T00:00:00Z','Synthetic fixture only');
