"""Run: python3 -m unittest discover -s scripts/trails -p 'test_*.py'."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('build_trails', Path(__file__).with_name('build_trails.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class NormalizationTests(unittest.TestCase):
    def test_hiker_priority_and_no_inferred_motor_permission(self):
        p = build.normalize_properties('usfs_trails', {
            'trail_name': 'RIDGE', 'trail_no': '12', 'trail_type': 'TERRA',
            'hiker_pedestrian_managed': '01/01-12/31', 'bicycle_accpt': '01/01-12/31',
            'motorcycle_restricted': '01/01-12/31', 'trail_surface': 'NATIVE MATERIAL',
        }, '2025-05-11')
        self.assertEqual((p['type'], p['uses'], p['mvum']), ('foot', 'Hike, Bike', 0))
        self.assertEqual((p['name'], p['surface'], p['date']), ('RIDGE (12)', 'Native', '2025-05-11'))

    def test_mvum_motor_dates_and_merge(self):
        m = build.normalize_properties('usfs_mvum_trails', {
            'atv': 'open', 'ATV_DATESOPEN': '05/15-11/30',
            'motorcycle': 'open', 'MOTORCYCLE_DATESOPEN': '01/01-12/31',
            'otherwheeled_ohv': 'closed', 'SEASONAL': 'seasonal',
        })
        self.assertEqual((m['type'], m['mvum']), ('ohv', 1))
        self.assertEqual(m['uses'], 'ATV, Motorcycle')
        self.assertEqual(m['seasons'], 'ATV 05/15-11/30; Motorcycle all year')
        merged = build.merge_motor({'type':'foot', 'src':'usfs_trails', 'uses':'Hike', 'mvum':0}, m)
        self.assertEqual((merged['src'], merged['type'], merged['uses']), ('usfs_trails', 'ohv', 'Hike, ATV, Motorcycle'))
        repeated = build.merge_motor(merged, m)
        self.assertEqual(repeated['seasons'], merged['seasons'])

    def test_nfs_compact_allowed_use_codes(self):
        p=build.normalize_properties('usfs_trails', {'trail_type':'TERRA','allowed_terra_use':'65321'})
        self.assertEqual((p['type'],p['uses']),('ohv','Hike, Horse, Bike, ATV, OHV'))
        p=build.normalize_properties('usfs_trails', {'trail_type':'SNOW','allowed_snow_use':'321','allowed_terra_use':'1'})
        self.assertEqual((p['type'],p['uses']),('snow','Snowmobile, Ski, Snowshoe'))

    def test_mvum_designation_with_missing_vehicle_class(self):
        m=build.normalize_properties('usfs_mvum_trails', {'seasonal':'seasonal'})
        self.assertEqual((m['type'],m['mvum']),('ohv',1))
        self.assertNotIn('uses',m)
        self.assertEqual(build.merge_motor({'type':'foot','uses':'Hike'},m)['type'],'ohv')

    def test_roads_closed_retained_decommissioned_removed(self):
        p = build.normalize_properties('usfs_roads', {'oper_maint_level':'1 - BASIC CUSTODIAL CARE (CLOSED)', 'route_status':'EX - EXISTING', 'objective_maint_level':'D - DECOMMISSION'})
        self.assertEqual((p['type'],p['mvum']), ('road',0))
        # Objective D is a future objective, not current decommissioned status.
        self.assertIsNone(build.normalize_properties('usfs_roads', {'route_status':'DECOMMISSIONED'}))
        self.assertIsNone(build.normalize_properties('usfs_roads', {'oper_maint_level':'D - DECOMMISSION'}))

    def test_snow_and_allowed_use_priority(self):
        self.assertEqual(build.trail_type({'Snowmobile','Ski'}), 'snow')
        self.assertEqual(build.trail_type({'Ski','Hike'}), 'foot')
        self.assertEqual(build.trail_type({'Bike','Horse'}), 'bike')
        self.assertEqual(build.trail_type({'Horse'}), 'horse')
        self.assertEqual(build.trail_type({'Hike','ATV'}), 'ohv')

    def test_only_federal_origin_ndt_and_water_excluded(self):
        for origin in ['Wisconsin DNR', 'Dane County', 'National Park Service', 'US Forest Service', 'Bureau of Land Management', '']:
            self.assertIsNone(build.normalize_properties('usgs_ndt', {'sourceoriginator':origin,'primarytrailmaintainer':'FWS'}))
        self.assertIsNone(build.normalize_properties('usgs_ndt', {'sourceoriginator':'US Fish and Wildlife Service','trailtype':'Water Trail'}))
        p=build.normalize_properties('usgs_ndt', {'sourceoriginator':'US Fish and Wildlife Service','hikerpedestrian':'Y','bicycle':'N','sourceeditdate':1609459200000})
        self.assertEqual((p['agency'], p['uses'], p['date']), ('FWS','Hike','2021-01-01'))
        self.assertIsNone(build.normalize_properties('usgs_ndt', {'sourceoriginator':'US Fish and Wildlife Service','primarytrailmaintainer':'FS'}))

    def test_nps_public_extant_and_sidewalks(self):
        for fields in [{'ISEXTANT':'No'}, {'OPENTOPUBLIC':'False'}, {'TRLFEATTYPE':'Sidewalk'}, {'TRLFEATTYPE':'Park Trail', 'TRLTYPE':'Sidewalk'}, {'PUBLICDISPLAY':'No Public Map Display'}, {'ORIGINATOR':'County'}]:
            self.assertIsNone(build.normalize_properties('nps_trails',fields))
        p=build.normalize_properties('nps_trails', {'ISEXTANT':'True','TRLUSE':'Hiker/Pedestrian','DATAACCESS':'Unrestricted'})
        self.assertEqual(p['type'],'foot')
        p=build.normalize_properties('nps_trails', {'TRLUSE':'Bike | Hike'})
        self.assertEqual((p['type'],p['uses']),('foot','Hike, Bike'))
        self.assertEqual(build.normalize_properties('nps_trails', {'TRLUSE':'Motorized'})['type'],'ohv')

    def test_blm_modes_and_access(self):
        p=build.normalize_properties('blm_gtlf', {'PLAN_ALLOW_MODE_TRNSPRT':'MTC_ATV_SHARED','PLAN_ASSET_CLASS':'Transportation System - Trail'})
        self.assertEqual((p['type'],p['mvum']),('ohv',0))
        self.assertEqual(build.normalize_properties('blm_gtlf', {'PLAN_ALLOW_MODE_TRNSPRT':'SNOW_MOTO_ONLY'})['type'],'snow')
        self.assertIsNone(build.normalize_properties('blm_gtlf', {'PLAN_ACCESS_RSTRCT':'Admin Only'}))

    def test_short_geographic_segments_are_not_dropped(self):
        # A ~8m geographic line is <0.01 degrees, yet must reach high-zoom tiles.
        class Line:
            is_empty = False
            geom_type = 'LineString'
            length = 0.0001
            coords = [(-90,44), (-89.9999,44)]
        self.assertEqual(list(build.lines(Line()))[0].length, 0.0001)
        self.assertAlmostEqual(build.length_km(Line()), 0.008, places=4)

    def test_documented_usgs_originator_spelling(self):
        self.assertEqual(build.federal_agency('Tenneessee Valley Authority'),'TVA')

    def test_dbf_names_require_validated_ordinal_schema(self):
        aliases=build.canonical_dbf_fields(['TRAIL_CN','ATV_DATESO','MOTORCYC_1'], ['OBJECTID','TRAIL_CN','ATV_DATESOPEN','MOTORCYCLE_DATESOPEN','SHAPE'])
        self.assertEqual(aliases['atv_dateso'],'atv_datesopen')
        self.assertEqual(aliases['motorcyc_1'],'motorcycle_datesopen')
        with self.assertRaises(RuntimeError):
            build.canonical_dbf_fields(['TRAIL_CN','BAD_FIELD'],['TRAIL_CN','ATV_DATESOPEN'])
        with self.assertRaises(RuntimeError):
            build.canonical_dbf_fields(['TRAIL_CN'],['TRAIL_CN','ID'])

    def test_route_numbers_scoped_to_forest(self):
        self.assertEqual(build.route_keys({'TRAIL_CN':'123','TRAIL_NO':'7','ADMIN_ORG':'090101'}), {'cn:123','no:0901:7'})
        self.assertFalse(build.route_keys({'id':'7','securityid':'0901'}) & build.route_keys({'id':'7','securityid':'0902'}))


if __name__=='__main__':
    unittest.main()
