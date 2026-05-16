from decimal import Decimal

from autocontent.services.xai_pricing import imagine_video_cost


def test_imagine_video_cost_per_second():
    assert imagine_video_cost(1.0) == Decimal("0.0500")
    assert imagine_video_cost(5.0) == Decimal("0.2500")
    assert imagine_video_cost(15.0) == Decimal("0.7500")
