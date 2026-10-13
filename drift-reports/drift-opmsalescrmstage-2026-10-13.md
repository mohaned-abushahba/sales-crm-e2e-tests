# Config drift — opmsalescrmstage (2026-10-13)

Update sets checked: 20 · records: 1048 · not checkable: 8
Source instance for layer 2: .env

| Finding | Count |
|---|---|
| missing-on-target | 1 |
| field-mismatch | 5 |
| changed-after-capture | 0 |
| uncaptured-missing-on-target | 55 |
| unreadable-table | 4 |

## missing-on-target

- `sys_ui_section` 3f4b8d884fd862107596e9b058c7140f — sys_ui_section_3f4b8d884fd862107596e9b058c7140f (UPDATE-014-partner-segmentation.xml)

## field-mismatch

- `sp_portal` f264dbaccbfd52108d3f6a6fc041e4b5 — sp_portal_f264dbaccbfd52108d3f6a6fc041e4b5 (UPDATE-003-enable-business-portal.xml)
  - `logo`: captured `7818298cffd82210aa38fffffffffff7` vs target `f8477d1c3b8f0310d5260fa693e45a9e`
  - `logo_alt_text`: captured `` vs target `Business Portal`
- `sys_dictionary` 7ba011662bc307504deaf02ac891bf9d — sn_ind_tmt_orm_order (UPDATE-004-crm-custom-fields-and-choices.xml)
  - `attributes`: captured `` vs target `edge_encryption_enabled=true,encode_utf8=false`
- `sys_report` 12797d642b53c3504deaf02ac891bf58 —  (UPDATE-016-workspace-landing-pages-dashboards.xml)
  - `name`: captured `` vs target `Sales Lead Funnel 2`
- `sys_report` ddfc41602b5b83504deaf02ac891bf7d — Sales Funnel Report (UPDATE-016-workspace-landing-pages-dashboards.xml)
  - `roles`: captured `` vs target `snc_internal`
- `sys_granular_delegate` c47c590e2b43cf104deaf02ac891bf9a — sys_granular_delegate_c47c590e2b43cf104deaf02ac891bf9a (UPDATE-022-audit-gap-fixes.xml)
  - `delegate_notified`: captured `1` vs target `0`

## uncaptured-missing-on-target

- `sn_adv_appr_mgmt_approval_group` 54969ed03b0b4310d5260fa693e45a61 —  — source created 2026-08-27 21:57:03 by admin; updated 2026-08-27 21:57:03 by admin
- `sn_adv_appr_mgmt_approval_group` d4165a903bc74310d5260fa693e45ae9 —  — source created 2026-08-27 21:54:56 by admin; updated 2026-08-27 21:54:56 by admin
- `sys_decision_multi_result` 7e817a903b4f4310d5260fa693e45a58 —  — source created 2026-08-27 23:54:50 by admin; updated 2026-08-27 23:54:50 by admin
- `sys_granular_delegate` 6c8c490e2b8f8f104deaf02ac891bfcd —  — source created 2026-09-02 03:03:33 by rebecca.smith; updated 2026-09-02 04:00:01 by admin
- `sys_granular_delegate` f047594a2b03cf104deaf02ac891bf42 —  — source created 2026-09-02 03:49:45 by rebecca.smith; updated 2026-09-02 03:50:00 by admin
- `sys_hub_flow` 0eacaed03b0f4310d5260fa693e45a6e — TEST Header tasks at submission for new add orders — source created 2026-08-27 23:33:29 by admin; updated 2026-08-28 00:23:47 by admin
- `sys_properties` 03a417a4ff970f1033ebffffffffffb1 — aiux.ainpx.tracing_enabled — source created 2026-09-10 07:26:01 by admin; updated 2026-09-10 07:26:01 by admin
- `sys_properties` 3809e04d472fcb109ada569fe16d4321 — sn_metadata_search.build_agent_last_active — source created 2026-09-23 18:25:10 by admin; updated 2026-10-07 22:08:36 by admin
- `sys_properties` 66158db0c3670b100918dac4e4013194 — glide_encryption.set_value_support_cle.disabled — source created 2026-09-23 01:49:24 by admin; updated 2026-09-23 01:49:24 by admin
- `sys_properties` 81054d70c3670b100918dac4e4013164 — com.glide.encryption.is_ec_encryption_allowed — source created 2026-09-23 01:49:02 by admin; updated 2026-09-23 01:49:02 by admin
- `sys_properties` 8205cd70c3670b100918dac4e40131cd — glide_encryption.enterprise_cle_license.hard_paywall_on — source created 2026-09-23 01:49:06 by admin; updated 2026-09-23 01:49:06 by admin
- `sys_properties` ce05cd70c3670b100918dac4e40131cf — glide_encryption.cle_replatforming_with_kmf — source created 2026-09-23 01:49:06 by admin; updated 2026-09-23 01:49:06 by admin
- `sys_properties` d8d1e394c3a743100918dac4e40131aa — sn_ai_governance.mcp_server_fixit_2026_Q1 — source created 2026-09-21 23:57:09 by admin; updated 2026-09-21 23:57:09 by admin
- `sys_script` 1464d6987ba44b9bb2f06c5373ee033e — Update Module — source created 2026-09-25 16:30:26 by admin; updated 2026-09-25 16:30:26 by admin
- `sys_script` 1b2f2639c46c402bbae88c2339cad373 — Create Module — source created 2026-09-25 16:30:26 by admin; updated 2026-09-25 16:30:26 by admin
- `sys_script` 1c0fe056072542cb890fc4fd805b9288 — Reject cross-scope collection variant of — source created 2026-08-26 20:00:00 by admin; updated 2026-08-26 20:00:00 by admin
- `sys_script` 334d76faff7a0310dcdbffffffffffb5 — Trigger email for default DD scan — source created 2026-08-23 09:05:37 by admin; updated 2026-08-25 12:48:50 by admin
- `sys_script` 3745bda221ea4f43a49a1a1a538fbc3b — Reject cross-scope extension of a non-ex — source created 2026-08-26 20:00:00 by admin; updated 2026-08-26 20:00:00 by admin
- `sys_script` 55a799e5ff0b4310ec57ffffffffff50 — Prevent null sys_og_routing_context — source created 2026-08-31 14:34:28 by admin; updated 2026-08-31 14:34:56 by admin
- `sys_script` dd5d74f9ee9f45f296f06b53d93930ab — Reject cross-scope route map onto a non- — source created 2026-08-26 20:00:00 by admin; updated 2026-08-26 20:00:00 by admin
- `sys_script` eb8d34c7cc5645cda242cf5f314bbc58 — Log Task Changes — source created 2026-08-27 04:54:26 by admin; updated 2026-08-27 04:54:26 by admin
- `sys_script` ff6bbd2e615946c08c17c2b194b57c29 — Log Configuration Changes — source created 2026-08-27 04:54:26 by admin; updated 2026-08-27 04:54:26 by admin
- `sys_script_include` 854166e68324484fa918a60398f0795d — AIXUserPreferenceAPI — source created 2026-09-10 00:00:00 by admin; updated 2026-09-10 00:00:00 by admin
- `sys_ui_section` 47c7b1503bcf0310d5260fa693e45ab1 — customer_contact — source created 2026-08-27 19:42:32 by admin; updated 2026-08-27 19:42:32 by admin
- `sys_ui_section` 4d678e253b4b8b10d5260fa693e45a6c — fx_rate — source created 2026-08-31 18:03:05 by admin; updated 2026-08-31 18:03:05 by admin
- `sys_ui_section` 767d26003bc38f10d5260fa693e45a29 — x_snc_change_log_0_log — source created 2026-08-27 04:58:36 by admin; updated 2026-08-27 04:58:36 by admin
- `sys_ui_section` ac05804e2b438f104deaf02ac891bf5c — sys_mutex — source created 2026-09-01 21:50:23 by admin; updated 2026-09-01 21:50:23 by admin
- `sys_ui_view` 2c6509b4c3670b100918dac4e4013100 — RPTd2c00800c330020050da1a4112d3ae08 — source created 2026-09-23 01:50:38 by admin; updated 2026-09-23 01:50:38 by admin
- `sys_ui_view` 3ba3157847630b109ada569fe16d437f — calendar — source created 2026-09-23 02:53:07 by admin; updated 2026-09-23 02:53:07 by admin
- `sys_ui_view` 6e658db4c3670b100918dac4e40131de — fsmcp — source created 2026-09-23 01:50:47 by admin; updated 2026-09-23 01:50:47 by admin
- `sys_ui_view` 7919c5fc47a7c7109ada569fe16d43cc — workspace_apw_default — source created 2026-09-23 02:06:50 by admin; updated 2026-09-23 02:06:50 by admin
- `sys_ui_view` a0b3597847630b109ada569fe16d43f0 — acc_onb_tech_import_task_view — source created 2026-09-23 02:53:09 by admin; updated 2026-09-23 02:53:09 by admin
- `sys_ui_view` a465c5b4c3670b100918dac4e40131ee — RPT1560c400c330020050da1a4112d3ae67 — source created 2026-09-23 01:50:38 by admin; updated 2026-09-23 01:50:38 by admin
- `sys_ui_view` bdd5cd3cc3670b100918dac4e40131fc — field_services — source created 2026-09-23 01:52:38 by admin; updated 2026-09-23 01:52:38 by admin
- `sys_ui_view` c4c315f847630b109ada569fe16d43da — tech_pad_list_view — source created 2026-09-23 02:53:24 by admin; updated 2026-09-23 02:53:24 by admin
- `sys_ui_view` d0a1913447efc7109ada569fe16d439b — dpr_phase_view — source created 2026-09-23 02:44:08 by admin; updated 2026-09-23 02:44:08 by admin
- `sys_ui_view` d98211f047230b109ada569fe16d4372 — dpr_task_panel_view — source created 2026-09-23 02:48:01 by admin; updated 2026-09-23 02:48:01 by admin
- `sys_ux_event` 1bf9a83a898d1baabcabbc107b1facfa —  — source created 2026-09-11 01:38:00 by tectonic; updated 2026-09-11 01:38:00 by tectonic
- `sys_ux_event` 6035c5d4f26faa403cdf9b9e83458a02 —  — source created 2026-08-27 11:06:29 by tectonic; updated 2026-08-27 11:06:29 by tectonic
- `sys_ux_event` 608e318f2bd8f75d360b1bf2c7d2c809 —  — source created 2026-09-11 01:38:13 by tectonic; updated 2026-09-11 01:38:13 by tectonic
- `sys_ux_event` 8a1ab4d28a2f7666aea6bb20cd3288c1 —  — source created 2026-09-11 01:38:00 by tectonic; updated 2026-09-11 01:38:00 by tectonic
- `sys_ux_event` c6217dde5e6498b3efa9f4a18b108f7a —  — source created 2026-09-11 01:38:13 by tectonic; updated 2026-09-11 01:38:13 by tectonic
- `sys_ux_event` ddf14b17f3cc0f264135423e9fbc8811 —  — source created 2026-09-22 07:14:08 by tectonic; updated 2026-09-22 07:14:08 by tectonic
- `sys_ux_macroponent` 0d1153fe1492d6ef880c381b25957633 — sn-wdf-unified-hub-404-page — source created 2026-09-11 02:38:15 by tectonic; updated 2026-09-11 02:38:15 by tectonic
- `sys_ux_macroponent` 1efa885e18474bbebf524ce11530cf80 — sn-par-breakdown-relation — source created 2026-09-09 19:07:55 by tectonic; updated 2026-09-09 19:07:55 by tectonic
- `sys_ux_macroponent` 2a21b9a0d934acb8ecd7ced56a1c160b — sn-par-highlight-field — source created 2026-09-09 19:08:15 by tectonic; updated 2026-09-09 19:08:15 by tectonic
- `sys_ux_macroponent` 401b992759c1606915fe2522dc5c08e7 — sn-embeddables-base — source created 2026-09-25 16:29:41 by tectonic; updated 2026-09-25 16:29:41 by tectonic
- `sys_ux_macroponent` 6ac9b35e8ae00cf74ff3c52fad1d63e8 — SN Seismic Karuna Widget — source created 2026-09-11 18:14:44 by tectonic; updated 2026-09-11 18:14:44 by tectonic
- `sys_ux_macroponent` 7d0606a60f50bacb97befbd78181395b — sn-on-call-calendar-row-title — source created 2026-08-27 11:06:29 by tectonic; updated 2026-08-27 11:06:29 by tectonic
- `sys_ux_macroponent` ac7f6844c85ffef3b5a43c3eded20ee7 — sn-wdf-credits-landing-page — source created 2026-09-11 02:38:23 by tectonic; updated 2026-09-11 02:38:23 by tectonic
- `sys_ux_macroponent` cfbb11e8c0638d22f0dc8ff1342218bd — sn-text2analytics-vis — source created 2026-08-26 01:41:10 by tectonic; updated 2026-08-26 01:41:10 by tectonic
- `sys_ux_macroponent` de365dc9e236b4e5869f0d71b2411335 — sn-on-call-calendar-span — source created 2026-08-27 11:06:29 by tectonic; updated 2026-08-27 11:06:29 by tectonic
- `sys_ux_macroponent` e5e2d781807827f2759065511f3cf4b5 — sn-wdf-hub-sidebar — source created 2026-09-11 02:38:15 by tectonic; updated 2026-09-11 02:38:15 by tectonic
- `sys_ux_macroponent` ea209b1c27bbac1f8d26974868544289 — sn-text2analytics-activation — source created 2026-08-26 01:41:11 by tectonic; updated 2026-08-26 01:41:11 by tectonic
- `sysevent_email_action` 4d654bbeffba0310dcdbffffffffffdc — Sensitive Data Visibility Report — source created 2026-08-23 09:31:42 by admin; updated 2026-08-25 12:50:59 by admin

## unreadable-table (Table API refused; not verified)

- `sys_ui_form_sections` UPDATE-007-quote-defaulting-automation.xml Error: Query sys_ui_form_sections failed: 400 {"error":{"message":"Invalid table sys_ui_form_sections","detail":null},"status":"failure"}
- `sys_client_script`  source Error: 400
- `sys_ui_form_sections`  source Error: 400
- `sys_variable_value`  target

## not checkable (no sys_id in payload)

- UPDATE-004-crm-custom-fields-and-choices.xml: sys_choice_customer_account_u_market_segment
- UPDATE-004-crm-custom-fields-and-choices.xml: sys_choice_sn_quote_mgmt_core_quote_route_to_market
- UPDATE-008-account-actions-and-forms.xml: sys_ui_related_customer_account_test
- UPDATE-008-account-actions-and-forms.xml: sys_ui_related_customer_account_workspace
- UPDATE-011-cpq-pricing-decision-tables.xml: sys_choice_var__m_sys_decision_multi_result_element_6bb03e662b8347504deaf02ac891bf1a_header_price_list_type
- UPDATE-011-cpq-pricing-decision-tables.xml: sys_choice_var__m_sys_decision_multi_result_element_e32d88982b9f8f104deaf02ac891bf13_header_price_list_type
- UPDATE-011-cpq-pricing-decision-tables.xml: sys_choice_var__m_sys_decision_multi_result_element_5d8794f9ff923610998fffffffffff16_scope
- UPDATE-014-partner-segmentation.xml: sys_ui_related_sn_prm_channel_partner_sales
