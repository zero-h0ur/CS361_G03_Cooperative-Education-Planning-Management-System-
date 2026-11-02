-- Disposable local data only. These credentials have no AWS access.
CREATE DATABASE coed_v3_test;
CREATE DATABASE coed_selection_test;
CREATE ROLE coed_app LOGIN PASSWORD 'coed_local_runtime_only';
